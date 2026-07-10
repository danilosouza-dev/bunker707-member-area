"use client";

import {
  Activity,
  ArrowLeft,
  ArrowRightLeft,
  Ban,
  Bell,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Copy,
  Eye,
  GalleryVerticalEnd,
  KeyRound,
  LibraryBig,
  Mail,
  Menu,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Search,
  Send,
  Trash2,
  TrendingUp,
  Users,
  X
} from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { CatalogCommandCenter } from "@/components/admin/catalog/catalog-command-center";
import { AIAgentsCommandCenter } from "@/components/admin/ai-agents/ai-agents-command-center";
import { AdminOverview } from "@/components/admin/admin-overview";
import { AdminShell } from "@/components/admin/admin-shell";
import { CombosCommandCenter } from "@/components/admin/combos/combos-command-center";
import { CommunityPlaceholder } from "@/components/admin/community/community-placeholder";
import { ModerationCommandCenter } from "@/components/admin/moderation/moderation-command-center";
import { PersonalizationCommandCenter } from "@/components/admin/personalization/personalization-command-center";
import { IntegrationsCommandCenter } from "@/components/admin/settings/integrations-command-center";
import { StudentsCommandCenter } from "@/components/admin/students/students-command-center";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { ContentRow, CourseModulesHomeSection } from "@/components/content-row";
import { ContentStructureSection } from "@/components/content-structure-section";
import { HeroSection } from "@/components/hero-section";
import { LoginExperience } from "@/components/login-experience";
import { MemberFooter } from "@/components/member-footer";
import { PurchasesExperience } from "@/components/purchases-experience";
import { getLoginPageConfig, loginTemplateOptions } from "@/lib/login-config";
import type { LoginPageConfig, LoginTemplateId } from "@/lib/login-config";
import type {
  AdminContentAccess,
  AdminContentRecord,
  AdminDashboardData,
  AdminEntitlementStatus,
  AdminHomeSection,
  AdminProductCombo,
  AdminReleaseRule,
  AdminSellableProduct,
  AdminSourceProvider,
  AdminStudent,
  AdminStudentCourse,
  AdminView,
  CommerceScope,
  ContentAccessModel,
  ContentKind,
  CoursePresentationMode,
  ContentStatus,
  CourseModule,
  HomeRow,
  LessonPreview,
  LessonVideoProvider,
  LockedContentActionMode,
  PurchaseTarget
} from "@/lib/platform-types";

const panelClassName = "rounded-[8px] border border-white/10 bg-[#171717] shadow-2xl shadow-black/20";
const inputClassName =
  "h-11 rounded-[8px] border border-white/10 bg-black/30 px-3 text-sm font-semibold text-white outline-none transition placeholder:text-zinc-600 focus:border-white/30";
const studentFormInputClassName =
  "h-10 rounded-[8px] border border-white/10 bg-[#111217] px-3 text-sm font-semibold text-white outline-none transition placeholder:text-zinc-600 focus:border-white/30 focus:ring-3 focus:ring-white/10";
const creatableContentKinds = ["Formacao", "Curso", "Mentoria", "Webinario", "Produto", "Bootcamp"] satisfies ContentKind[];
const courseLayoutContentKinds = ["Curso", "Bootcamp", "Mentoria", "Webinario", "Produto"] satisfies ContentKind[];

function supportsCoursePresentationMode(kind: ContentKind) {
  return (courseLayoutContentKinds as readonly ContentKind[]).includes(kind);
}

function getAccessClassName(access: AdminContentAccess) {
  if (access === "Liberado") {
    return "border-emerald-400/25 bg-emerald-500/10 text-emerald-300";
  }

  if (access === "Drip") {
    return "border-amber-400/25 bg-amber-500/10 text-amber-300";
  }

  if (access === "Em breve") {
    return "border-sky-400/25 bg-sky-500/10 text-sky-300";
  }

  return "border-red-400/25 bg-red-500/10 text-red-300";
}

function getContentAccessModelLabel(accessModel?: ContentAccessModel) {
  return accessModel === "free" ? "Gratuito" : "Fechado";
}

function getContentAccessModelClassName(accessModel?: ContentAccessModel) {
  return accessModel === "free"
    ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-300"
    : "border-red-400/25 bg-red-500/10 text-red-200";
}

function getStudentLimitLabel(maxStudents?: number | null) {
  return maxStudents && maxStudents > 0 ? `${maxStudents} estudantes` : "Ilimitado";
}

function getReleaseModeLabel(mode: AdminReleaseRule["mode"]) {
  if (mode === "immediate") {
    return "Liberar imediatamente";
  }

  if (mode === "after_enrollment") {
    return "Apos inscricao";
  }

  if (mode === "after_purchase") {
    return "Depois da compra";
  }

  if (mode === "after_previous_lesson") {
    return "Depois da aula anterior";
  }

  if (mode === "fixed_date") {
    return "Data fixa";
  }

  return "Atividade obrigatoria";
}

function getEntitlementStatusLabel(status: AdminEntitlementStatus) {
  if (status === "active") {
    return "Ativo";
  }

  if (status === "suspended") {
    return "Suspenso";
  }

  if (status === "revoked") {
    return "Revogado";
  }

  return "Expirado";
}

function getEntitlementStatusClassName(status: AdminEntitlementStatus) {
  if (status === "active") {
    return "border-emerald-400/25 bg-emerald-500/10 text-emerald-300";
  }

  if (status === "suspended") {
    return "border-amber-400/25 bg-amber-500/10 text-amber-300";
  }

  if (status === "expired") {
    return "border-zinc-400/20 bg-zinc-500/10 text-zinc-300";
  }

  return "border-red-400/25 bg-red-500/10 text-red-300";
}

function getSoftEntitlementStatusClassName(status: AdminEntitlementStatus) {
  if (status === "active") {
    return "border-emerald-400/25 bg-emerald-500/10 text-emerald-200";
  }

  if (status === "suspended") {
    return "border-amber-400/25 bg-amber-500/10 text-amber-200";
  }

  if (status === "expired") {
    return "border-zinc-400/20 bg-zinc-500/10 text-zinc-300";
  }

  return "border-red-400/25 bg-red-500/10 text-red-200";
}

function getStudentAccessOverview(student: AdminStudent) {
  const activeCourses = student.courses.filter((course) => course.status === "active").length;
  const blockedCourses = student.courses.filter((course) => course.status !== "active").length;

  if (student.status === "expired") {
    return {
      className: "border-red-400/25 bg-red-500/10 text-red-200",
      label: "Bloqueado por pagamento"
    };
  }

  if (activeCourses > 0 && blockedCourses > 0) {
    return {
      className: "border-amber-300/25 bg-amber-400/10 text-amber-200",
      label: "Misto"
    };
  }

  return {
    className: getEntitlementStatusClassName(student.status),
    label: getEntitlementStatusLabel(student.status)
  };
}

function getSoftStudentAccessOverviewClassName(student: AdminStudent) {
  const overview = getStudentAccessOverview(student);

  if (overview.label === "Misto") {
    return "border-amber-400/25 bg-amber-500/10 text-amber-200";
  }

  return getSoftEntitlementStatusClassName(student.status);
}

function getProviderClassName(provider: AdminSourceProvider) {
  if (provider === "Hotmart") {
    return "border-orange-400/25 bg-orange-500/10 text-orange-200";
  }

  if (provider === "Ticto") {
    return "border-sky-400/25 bg-sky-500/10 text-sky-200";
  }

  if (provider === "TikTok") {
    return "border-fuchsia-400/25 bg-fuchsia-500/10 text-fuchsia-200";
  }

  if (provider === "Kiwify") {
    return "border-lime-400/25 bg-lime-500/10 text-lime-200";
  }

  return "border-white/10 bg-white/[0.055] text-zinc-300";
}

function normalizeSearchValue(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function StatusPill({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <Badge variant="outline" className={`h-6 min-h-6 rounded-full px-2.5 text-[11px] font-semibold ${className}`}>
      {children}
    </Badge>
  );
}

function CatalogTable({
  filteredRecords,
  onDeleteRecord,
  onEditRecord,
  onSelectRecord,
  selectedRecord
}: {
  filteredRecords: AdminContentRecord[];
  onDeleteRecord: (record: AdminContentRecord) => void;
  onEditRecord: (record: AdminContentRecord) => void;
  onSelectRecord: (record: AdminContentRecord) => void;
  selectedRecord?: AdminContentRecord;
}) {
  return (
    <div className={`${panelClassName} overflow-hidden`}>
      <div className="grid min-w-[66rem] grid-cols-[2fr_0.8fr_0.9fr_0.9fr_0.9fr_0.9fr_0.8fr] border-b border-white/10 px-4 py-3 text-xs font-black uppercase text-zinc-500">
        <span>Conteudo</span>
        <span>Tipo</span>
        <span>Modelo</span>
        <span>Acesso</span>
        <span>Limite</span>
        <span>Estrutura</span>
        <span className="text-right">Acoes</span>
      </div>

      <div className="overflow-x-auto">
        {filteredRecords.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-lg font-black text-white">Nenhum conteudo cadastrado.</p>
            <p className="mt-2 text-sm text-zinc-500">Comece criando uma formacao, curso, bootcamp ou aula do zero.</p>
          </div>
        ) : filteredRecords.map((record) => {
          const isSelected = selectedRecord?.content.id === record.content.id;

          return (
            <div
              className={`grid min-w-[66rem] grid-cols-[2fr_0.8fr_0.9fr_0.9fr_0.9fr_0.9fr_0.8fr] items-center gap-4 border-b border-white/10 px-4 py-4 text-left transition last:border-b-0 ${
                isSelected ? "bg-white/[0.075]" : "hover:bg-white/[0.045]"
              }`}
              key={record.content.id}
            >
              <button className="flex min-w-0 items-center gap-3 text-left" onClick={() => onSelectRecord(record)} type="button">
                <span className="relative h-16 w-11 shrink-0 overflow-hidden rounded-[6px] bg-[#101010]">
                  <span
                    className="absolute inset-0 bg-cover bg-center"
                    style={{ backgroundImage: `url(${record.content.image})` }}
                  />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-black text-white">{record.content.title}</span>
                  <span className="mt-1 block truncate text-xs font-semibold text-zinc-500">
                    {record.releaseSummary}
                  </span>
                </span>
              </button>
              <span className="text-sm font-bold text-zinc-300">{record.kind}</span>
              <span>
                <StatusPill className={getContentAccessModelClassName(record.content.accessModel)}>
                  {getContentAccessModelLabel(record.content.accessModel)}
                </StatusPill>
              </span>
              <span>
                <StatusPill className={getAccessClassName(record.access)}>{record.access}</StatusPill>
              </span>
              <span className="text-sm font-bold text-zinc-400">
                {getStudentLimitLabel(record.content.maxStudents)}
              </span>
              <span className="text-sm font-bold text-zinc-400">
                {record.modulesCount} mod. / {record.lessonsCount} aulas
              </span>
              <span className="flex justify-end gap-2">
                <button
                  aria-label={`Editar ${record.content.title}`}
                  className="grid h-9 w-9 place-items-center rounded-[7px] border border-white/10 bg-white/[0.055] text-zinc-300 transition hover:bg-white/10 hover:text-white"
                  onClick={() => onEditRecord(record)}
                  type="button"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  aria-label={`Excluir ${record.content.title}`}
                  className="grid h-9 w-9 place-items-center rounded-[7px] border border-red-400/20 bg-red-500/10 text-red-200 transition hover:bg-red-500/20 hover:text-white"
                  onClick={() => onDeleteRecord(record)}
                  type="button"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SelectedContentPanel({
  onDeleteRecord,
  onEditRecord,
  selectedRecord
}: {
  onDeleteRecord: (record: AdminContentRecord) => void;
  onEditRecord: (record: AdminContentRecord) => void;
  selectedRecord?: AdminContentRecord;
}) {
  if (!selectedRecord) {
    return (
      <aside className={`${panelClassName} p-5`}>
        <div className="grid min-h-[24rem] place-items-center text-center">
          <div>
            <BookOpen className="mx-auto h-8 w-8 text-zinc-600" />
            <h3 className="mt-4 text-lg font-black text-white">Catalogo vazio</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-500">
              Crie o primeiro conteudo para configurar capa, status e regras de liberacao.
            </p>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className={`${panelClassName} p-5`}>
      <div className="relative aspect-[720/1040] overflow-hidden rounded-[8px] bg-black">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${selectedRecord.content.image})` }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-4">
          <StatusPill className={getAccessClassName(selectedRecord.access)}>{selectedRecord.access}</StatusPill>
          <h2 className="mt-3 text-2xl font-black leading-tight text-white">{selectedRecord.content.title}</h2>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        {[
          ["Modelo", getContentAccessModelLabel(selectedRecord.content.accessModel)],
          ["Limite", getStudentLimitLabel(selectedRecord.content.maxStudents)],
          ["Compra", selectedRecord.content.purchaseUrl ? "Link configurado" : "Sem link"],
          ["Escopo", selectedRecord.commerceScope],
          ["Visibilidade", selectedRecord.visibility],
          ["Liberacao", selectedRecord.releaseSummary],
          ["Status", selectedRecord.status]
        ].map(([label, value]) => (
          <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-3 text-sm" key={label}>
            <span className="font-semibold text-zinc-500">{label}</span>
            <span className="text-right font-bold text-white">{value}</span>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-3">
        <button
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] bg-white px-4 py-2 text-sm font-black text-black transition hover:bg-zinc-200"
          onClick={() => onEditRecord(selectedRecord)}
          type="button"
        >
          <Pencil className="h-4 w-4" />
          Editar conteudo
        </button>
        <button
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] border border-red-400/20 bg-red-500/10 px-4 py-2 text-sm font-black text-red-100 transition hover:bg-red-500/20"
          onClick={() => onDeleteRecord(selectedRecord)}
          type="button"
        >
          <Trash2 className="h-4 w-4" />
          Excluir conteudo
        </button>
      </div>
    </aside>
  );
}

type ContentFormState = {
  accessModel: ContentAccessModel;
  commerceScope: CommerceScope;
  coursePresentationMode: CoursePresentationMode;
  description: string;
  homeModuleSectionEnabled: boolean;
  heroImage: string;
  image: string;
  kind: ContentKind;
  lockedActionMode: LockedContentActionMode;
  maxStudents: string;
  purchaseTarget: PurchaseTarget;
  purchaseUrl: string;
  releaseDelayUnit: "horas" | "dias";
  releaseDelayValue: string;
  releaseFixedDate: string;
  releaseMode: AdminReleaseRule["mode"];
  releaseRequirement: string;
  studentLimitMode: "unlimited" | "limited";
  status: ContentStatus;
  title: string;
  id?: string;
};

type ContentFormStep = "basic" | "modules" | "lessons";

type ImageUploadSpec = {
  height: number;
  label: string;
  width: number;
};

type ModuleBuilderFormState = {
  description: string;
  id?: string;
  image: string;
  releaseDelayUnit: "horas" | "dias";
  releaseDelayValue: string;
  releaseFixedDate: string;
  releaseMode: AdminReleaseRule["mode"];
  title: string;
};

type LessonBuilderFormState = {
  description: string;
  duration: string;
  id?: string;
  image: string;
  moduleId: string;
  releaseDelayUnit: "horas" | "dias";
  releaseDelayValue: string;
  releaseFixedDate: string;
  releaseMode: AdminReleaseRule["mode"];
  title: string;
  videoAssetId: string;
  videoEmbedCode: string;
  videoProvider: LessonVideoProvider;
  videoUrl: string;
};

const posterImageSpec = {
  height: 1040,
  label: "720 x 1040 px",
  width: 720
} satisfies ImageUploadSpec;
const heroImageSpec = {
  height: 720,
  label: "1920 x 720 px",
  width: 1920
} satisfies ImageUploadSpec;
const lessonVideoProviderOptions = [
  ["youtube", "YouTube"],
  ["vimeo", "Vimeo"],
  ["bunny", "Bunny Stream"],
  ["mux", "Mux"],
  ["custom_url", "Player proprio / URL"],
  ["embed_code", "Codigo embed"]
] satisfies Array<[LessonVideoProvider, string]>;

const emptyContentFormState: ContentFormState = {
  accessModel: "closed",
  commerceScope: "sellable_product",
  coursePresentationMode: "module_cards",
  description: "",
  homeModuleSectionEnabled: false,
  heroImage: "",
  image: "",
  kind: "Formacao",
  lockedActionMode: "details_modal",
  maxStudents: "",
  purchaseTarget: "same_tab",
  purchaseUrl: "",
  releaseDelayUnit: "dias",
  releaseDelayValue: "",
  releaseFixedDate: "",
  releaseMode: "immediate",
  releaseRequirement: "",
  studentLimitMode: "unlimited",
  status: "Bloqueado",
  title: ""
};

const emptyModuleBuilderFormState: ModuleBuilderFormState = {
  description: "",
  image: "",
  releaseDelayUnit: "dias",
  releaseDelayValue: "",
  releaseFixedDate: "",
  releaseMode: "immediate",
  title: ""
};

const emptyLessonBuilderFormState: LessonBuilderFormState = {
  description: "",
  duration: "",
  image: "",
  moduleId: "",
  releaseDelayUnit: "dias",
  releaseDelayValue: "",
  releaseFixedDate: "",
  releaseMode: "immediate",
  title: "",
  videoAssetId: "",
  videoEmbedCode: "",
  videoProvider: "youtube",
  videoUrl: ""
};

function contentRecordToFormState(record: AdminContentRecord): ContentFormState {
  return {
    accessModel: record.content.accessModel ?? (record.content.isLocked ? "closed" : "free"),
    commerceScope: record.commerceScope,
    coursePresentationMode: record.pageSettings?.coursePresentationMode ?? "module_cards",
    description: record.content.description ?? "",
    homeModuleSectionEnabled: Boolean(record.pageSettings?.homeModuleSection?.enabled),
    heroImage: record.pageSettings?.hero?.mediaSrc ?? "",
    id: record.content.id,
    image: record.content.image,
    kind: record.content.kind,
    lockedActionMode: record.pageSettings?.lockedActionMode ?? "details_modal",
    maxStudents: record.content.maxStudents ? String(record.content.maxStudents) : "",
    purchaseTarget: record.content.purchaseTarget ?? "same_tab",
    purchaseUrl: record.content.purchaseUrl ?? "",
    releaseDelayUnit: record.content.releaseRule?.delayUnit ?? "dias",
    releaseDelayValue: record.content.releaseRule?.delayValue ?? "",
    releaseFixedDate: record.content.releaseRule?.fixedDate ?? "",
    releaseMode: record.content.releaseRule?.mode ?? "immediate",
    releaseRequirement: record.content.releaseRule?.requirement ?? "",
    studentLimitMode: record.content.maxStudents ? "limited" : "unlimited",
    status: record.content.status,
    title: record.content.title
  };
}

function getReleaseRuleBuilderFields(releaseRule?: CourseModule["releaseRule"]) {
  return {
    releaseDelayUnit: releaseRule?.delayUnit ?? "dias",
    releaseDelayValue: releaseRule?.delayValue ?? "",
    releaseFixedDate: releaseRule?.fixedDate ?? "",
    releaseMode: releaseRule?.mode ?? "immediate"
  };
}

function moduleToBuilderForm(module: CourseModule): ModuleBuilderFormState {
  return {
    ...getReleaseRuleBuilderFields(module.releaseRule),
    description: module.description ?? "",
    id: module.id,
    image: module.image ?? "",
    title: module.title
  };
}

function lessonToBuilderForm(lesson: LessonPreview, moduleId: string): LessonBuilderFormState {
  return {
    ...getReleaseRuleBuilderFields(lesson.releaseRule),
    description: lesson.description ?? "",
    duration: lesson.duration ?? "",
    id: lesson.id,
    image: lesson.image ?? "",
    moduleId,
    title: lesson.title,
    videoAssetId: lesson.video?.assetId ?? "",
    videoEmbedCode: lesson.video?.embedCode ?? "",
    videoProvider: lesson.video?.provider ?? "youtube",
    videoUrl: lesson.video?.url ?? ""
  };
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      resolve(String(reader.result ?? ""));
    });
    reader.addEventListener("error", () => reject(new Error("Nao foi possivel ler a imagem.")));
    reader.readAsDataURL(file);
  });
}

function getImageDimensions(src: string) {
  return new Promise<{ height: number; width: number }>((resolve, reject) => {
    const image = new window.Image();

    image.addEventListener("load", () => {
      resolve({
        height: image.naturalHeight,
        width: image.naturalWidth
      });
    });
    image.addEventListener("error", () => reject(new Error("Nao foi possivel validar a imagem.")));
    image.src = src;
  });
}

async function readValidatedImage(file: File, spec: ImageUploadSpec) {
  const src = await readFileAsDataUrl(file);
  const dimensions = await getImageDimensions(src);

  if (dimensions.width !== spec.width || dimensions.height !== spec.height) {
    throw new Error(`Envie uma imagem em ${spec.label}. Arquivo atual: ${dimensions.width} x ${dimensions.height} px.`);
  }

  return src;
}

function buildLessonVideoConfig(form: LessonBuilderFormState) {
  const url = form.videoUrl.trim();
  const assetId = form.videoAssetId.trim();
  const embedCode = form.videoEmbedCode.trim();

  if (!url && !assetId && !embedCode) {
    return undefined;
  }

  return {
    assetId: assetId || undefined,
    embedCode: embedCode || undefined,
    provider: form.videoProvider,
    url: url || undefined
  };
}

function CatalogView({
  courseModules,
  onDashboardDataChange,
  records,
  selectedRecord,
  setSelectedRecord
}: {
  courseModules: CourseModule[];
  onDashboardDataChange: (data: AdminDashboardData) => void;
  records: AdminContentRecord[];
  selectedRecord?: AdminContentRecord;
  setSelectedRecord: (record: AdminContentRecord) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "sellable" | "included" | "locked">("all");
  const [contentFormOpen, setContentFormOpen] = useState(false);
  const [contentForm, setContentForm] = useState<ContentFormState>(emptyContentFormState);
  const [contentFormStep, setContentFormStep] = useState<ContentFormStep>("basic");
  const [imageUploadError, setImageUploadError] = useState("");
  const [lessonBuilderForm, setLessonBuilderForm] = useState<LessonBuilderFormState>(emptyLessonBuilderFormState);
  const [moduleBuilderForm, setModuleBuilderForm] = useState<ModuleBuilderFormState>(emptyModuleBuilderFormState);
  const normalizedQuery = query.trim().toLowerCase();
  const wizardRecord = contentForm.id
    ? records.find((record) => record.content.id === contentForm.id)
    : selectedRecord;
  const wizardModules = useMemo(() => {
    if (!wizardRecord) {
      return [] as CourseModule[];
    }

    const scopedModules = courseModules.filter((module) => module.ownerId === wizardRecord.content.id);

    if (scopedModules.length > 0) {
      return scopedModules;
    }

    const hasScopedModules = courseModules.some((module) => module.ownerId);
    return hasScopedModules ? [] : courseModules;
  }, [courseModules, wizardRecord]);
  const effectiveLessonModuleId = wizardModules.some((module) => module.id === lessonBuilderForm.moduleId)
    ? lessonBuilderForm.moduleId
    : wizardModules[0]?.id ?? "";

  const filteredRecords = useMemo(() => (
    records.filter((record) => {
      const matchesText = !normalizedQuery || [
        record.content.title,
        record.kind,
        record.status,
        record.access,
        record.releaseSummary
      ].some((value) => value.toLowerCase().includes(normalizedQuery));

      const matchesFilter =
        filter === "all" ||
        (filter === "sellable" && record.commerceScope === "sellable_product") ||
        (filter === "included" && record.commerceScope === "included_content") ||
        (filter === "locked" && record.access === "Bloqueado");

      return matchesText && matchesFilter;
    })
  ), [filter, normalizedQuery, records]);
  const isEditingModule = Boolean(moduleBuilderForm.id);
  const isEditingLesson = Boolean(lessonBuilderForm.id);
  const showCourseLayoutSwitch = supportsCoursePresentationMode(contentForm.kind);
  const usesSingleCardLayout = contentForm.coursePresentationMode === "lesson_playlist";

  function updateContentForm(field: keyof ContentFormState, value: boolean | string) {
    setContentForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function updateModuleBuilderForm(field: keyof ModuleBuilderFormState, value: string) {
    setModuleBuilderForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function updateLessonBuilderForm(field: keyof LessonBuilderFormState, value: string) {
    setLessonBuilderForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function editWizardModule(module: CourseModule) {
    setModuleBuilderForm(moduleToBuilderForm(module));
    setImageUploadError("");
    setContentFormStep("modules");
  }

  function cancelWizardModuleEdit() {
    setModuleBuilderForm(emptyModuleBuilderFormState);
    setImageUploadError("");
  }

  function editWizardLesson(moduleId: string, lesson: LessonPreview) {
    setLessonBuilderForm(lessonToBuilderForm(lesson, moduleId));
    setImageUploadError("");
    setContentFormStep("lessons");
  }

  function cancelWizardLessonEdit() {
    setLessonBuilderForm((current) => ({
      ...emptyLessonBuilderFormState,
      moduleId: current.moduleId
    }));
  }

  async function handleImageUpload(
    field: "heroImage" | "image",
    file: File | undefined,
    spec: ImageUploadSpec
  ) {
    if (!file) {
      return;
    }

    setImageUploadError("");

    try {
      const src = await readValidatedImage(file, spec);
      updateContentForm(field, src);
    } catch (error) {
      setImageUploadError(error instanceof Error ? error.message : "Nao foi possivel validar a imagem.");
    }
  }

  async function handleModuleImageUpload(file: File | undefined) {
    if (!file) {
      return;
    }

    setImageUploadError("");

    try {
      const src = await readValidatedImage(file, posterImageSpec);
      updateModuleBuilderForm("image", src);
    } catch (error) {
      setImageUploadError(error instanceof Error ? error.message : "Nao foi possivel validar a imagem.");
    }
  }

  async function postDashboardMutation(endpoint: string, payload: Record<string, unknown>) {
    const response = await fetch(endpoint, {
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const result = await response.json() as { data?: AdminDashboardData; error?: string };

    if (!response.ok || !result.data) {
      throw new Error(result.error ?? "Nao foi possivel salvar.");
    }

    onDashboardDataChange(result.data);
    return result.data;
  }

  async function submitContentForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contentForm.image.trim()) {
      setImageUploadError(`Envie a capa vertical do item em ${posterImageSpec.label}.`);
      return;
    }

    const previousRecordIds = new Set(records.map((record) => record.content.id));
    const maxStudents =
      contentForm.studentLimitMode === "limited" && contentForm.maxStudents.trim()
        ? Number(contentForm.maxStudents)
        : null;
    const isClosed = contentForm.accessModel === "closed";
    const status =
      contentForm.accessModel === "free" && contentForm.status === "Bloqueado"
        ? "Liberado"
        : contentForm.status;

    const response = await fetch("/api/admin/content", {
      body: JSON.stringify({
        ...contentForm,
        homeModuleSectionEnabled: contentForm.homeModuleSectionEnabled,
        isLocked: isClosed || status === "Bloqueado",
        lockedActionMode: contentForm.lockedActionMode,
        maxStudents,
        purchaseTarget: contentForm.purchaseTarget,
        purchaseUrl: contentForm.purchaseUrl.trim() || undefined,
        status,
        releaseRule: {
          delayUnit: contentForm.releaseDelayUnit,
          delayValue: contentForm.releaseDelayValue,
          fixedDate: contentForm.releaseFixedDate,
          mode: contentForm.releaseMode,
          requirement: contentForm.releaseRequirement
        }
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const result = await response.json() as { data?: AdminDashboardData; error?: string };

    if (!response.ok || !result.data) {
      throw new Error(result.error ?? "Nao foi possivel cadastrar conteudo.");
    }

    onDashboardDataChange(result.data);
    const savedRecord =
      result.data.contentRecords.find((record) => record.content.id === contentForm.id) ??
      result.data.contentRecords.find((record) => (
        !previousRecordIds.has(record.content.id) &&
        record.content.title === contentForm.title &&
        record.content.kind === contentForm.kind
      )) ??
      result.data.contentRecords.find((record) => (
        record.content.title === contentForm.title &&
        record.content.kind === contentForm.kind
      ));

    if (savedRecord) {
      setSelectedRecord(savedRecord);
      setContentForm(contentRecordToFormState(savedRecord));
      setContentFormStep("modules");
    } else {
      setContentForm(emptyContentFormState);
      setContentFormOpen(false);
    }
  }

  function openNewContentForm() {
    setContentForm(emptyContentFormState);
    setContentFormStep("basic");
    setImageUploadError("");
    setLessonBuilderForm(emptyLessonBuilderFormState);
    setModuleBuilderForm(emptyModuleBuilderFormState);
    setContentFormOpen(true);
  }

  function openEditContentForm(record: AdminContentRecord) {
    setContentForm(contentRecordToFormState(record));
    setContentFormStep("basic");
    setImageUploadError("");
    setLessonBuilderForm(emptyLessonBuilderFormState);
    setModuleBuilderForm(emptyModuleBuilderFormState);
    setContentFormOpen(true);
    setSelectedRecord(record);
  }

  async function deleteRecord(record: AdminContentRecord) {
    const confirmed = window.confirm(`Excluir "${record.content.title}"?`);

    if (!confirmed) {
      return;
    }

    const response = await fetch("/api/admin/content", {
      body: JSON.stringify({ id: record.content.id }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "DELETE"
    });
    const result = await response.json() as { data?: AdminDashboardData; error?: string };

    if (!response.ok || !result.data) {
      throw new Error(result.error ?? "Nao foi possivel excluir conteudo.");
    }

    onDashboardDataChange(result.data);
    setContentForm(emptyContentFormState);
    setContentFormStep("basic");
    setContentFormOpen(false);
  }

  async function submitWizardModule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!wizardRecord) {
      return;
    }

    const editingModuleId = moduleBuilderForm.id;
    const previousModuleIds = new Set(courseModules.map((module) => module.id));
    const nextData = await postDashboardMutation("/api/admin/modules", {
      description: moduleBuilderForm.description,
      id: editingModuleId,
      image: moduleBuilderForm.image,
      ownerId: wizardRecord.content.id,
      ownerKind: wizardRecord.kind,
      releaseDelayUnit: moduleBuilderForm.releaseDelayUnit,
      releaseDelayValue: moduleBuilderForm.releaseDelayValue,
      releaseFixedDate: moduleBuilderForm.releaseFixedDate,
      releaseMode: moduleBuilderForm.releaseMode,
      title: moduleBuilderForm.title
    });
    const savedModule =
      (editingModuleId ? nextData.courseModules.find((module) => module.id === editingModuleId) : undefined) ??
      nextData.courseModules.find((module) => (
        !previousModuleIds.has(module.id) &&
        module.ownerId === wizardRecord.content.id &&
        module.title === moduleBuilderForm.title
      ));

    setModuleBuilderForm(emptyModuleBuilderFormState);
    setLessonBuilderForm((current) => ({
      ...current,
      moduleId: savedModule?.id ?? current.moduleId
    }));
    setContentFormStep(editingModuleId ? "modules" : "lessons");
  }

  async function submitWizardLesson(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const moduleId = effectiveLessonModuleId;

    if (!moduleId) {
      return;
    }

    await postDashboardMutation("/api/admin/lessons", {
      description: lessonBuilderForm.description,
      duration: lessonBuilderForm.duration,
      id: lessonBuilderForm.id,
      image: lessonBuilderForm.image,
      moduleId,
      releaseDelayUnit: lessonBuilderForm.releaseDelayUnit,
      releaseDelayValue: lessonBuilderForm.releaseDelayValue,
      releaseFixedDate: lessonBuilderForm.releaseFixedDate,
      releaseMode: lessonBuilderForm.releaseMode,
      title: lessonBuilderForm.title,
      video: buildLessonVideoConfig(lessonBuilderForm) ?? null
    });
    setLessonBuilderForm((current) => ({
      ...emptyLessonBuilderFormState,
      moduleId: current.moduleId
    }));
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="min-w-0 space-y-5">
        <CatalogCommandCenter
          filter={filter}
          filteredRecords={filteredRecords}
          onCreateContent={openNewContentForm}
          onEditContent={openEditContentForm}
          onFilterChange={setFilter}
          onQueryChange={setQuery}
          onSelectRecord={setSelectedRecord}
          query={query}
          records={records}
          selectedRecord={selectedRecord}
        />

        <Dialog
          open={contentFormOpen}
          onOpenChange={(open) => {
            if (!open) {
              setContentFormOpen(false);
            }
          }}
        >
          <DialogContent
            className="h-[min(92dvh,900px)] max-w-[min(1180px,calc(100vw-2rem))] rounded-[12px] border border-white/10 bg-[#0d0e11] p-0 text-zinc-100 shadow-[0_34px_140px_rgba(0,0,0,0.78)] ring-1 ring-white/[0.035]"
            showCloseButton={false}
          >
            <DialogHeader className="shrink-0 border-b border-white/10 bg-[linear-gradient(135deg,#1c1114_0%,#17181d_42%,#101116_100%)] p-0">
              <div className="flex items-start justify-between gap-4 px-5 py-4 sm:px-7">
                <div className="min-w-0">
                  <DialogDescription className="text-sm font-semibold text-zinc-500">
                    <span className="text-zinc-200 underline underline-offset-2">Catalogo</span>
                    <span className="px-3 text-zinc-700">/</span>
                    <span>{contentForm.id ? "Edicao" : "Criacao"}</span>
                  </DialogDescription>
                  <DialogTitle className="mt-2 truncate text-2xl font-semibold tracking-normal text-white">
                    {contentForm.id ? "Editar item" : "Novo item educacional"}
                  </DialogTitle>
                  <p className="mt-2 max-w-3xl text-xs font-semibold leading-5 text-zinc-500">
                    Cadastre a configuracao inicial, avance para modulos e depois adicione aulas no mesmo fluxo. Voce tambem pode salvar so o primeiro passo e completar depois.
                  </p>
                </div>
                <Button
                  aria-label="Fechar modal do catalogo"
                  className="size-9 rounded-full text-zinc-500 hover:bg-white/10 hover:text-white"
                  onClick={() => setContentFormOpen(false)}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </DialogHeader>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
              <div className="grid gap-2 md:grid-cols-3">
              {[
                ["basic", "1. Configuracao"],
                ["modules", "2. Modulos"],
                ["lessons", "3. Aulas"]
              ].map(([id, label]) => {
                const isActive = contentFormStep === id;
                const isDisabled = id !== "basic" && !contentForm.id;

                return (
                  <button
                    className={`min-h-11 rounded-[8px] border px-3 text-left text-sm font-black transition ${
                      isActive
                        ? "border-white/20 bg-white text-black"
                        : "border-white/10 bg-black/20 text-zinc-300 hover:bg-white/10 hover:text-white"
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                    disabled={isDisabled}
                    key={id}
                    onClick={() => setContentFormStep(id as ContentFormStep)}
                    type="button"
                  >
                    {label}
                  </button>
                );
              })}
              </div>

              {imageUploadError ? (
              <div className="rounded-[8px] border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-100">
                {imageUploadError}
              </div>
              ) : null}

              {contentFormStep === "basic" ? (
              <form className="grid gap-3 lg:grid-cols-6" onSubmit={submitContentForm}>
                <label className="grid gap-1 text-xs font-black uppercase text-zinc-500 lg:col-span-2">
                  Nome
                  <input
                    className={inputClassName}
                    onChange={(event) => updateContentForm("title", event.target.value)}
                    required
                    value={contentForm.title}
                  />
                </label>
                <label className="grid gap-1 text-xs font-black uppercase text-zinc-500">
                  Tipo de item
                  <select
                    className={inputClassName}
                    onChange={(event) => updateContentForm("kind", event.target.value)}
                    value={contentForm.kind}
                  >
                    {creatableContentKinds.map((kind) => (
                      <option key={kind}>{kind}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-black uppercase text-zinc-500">
                  Catalogo
                  <select
                    className={inputClassName}
                    onChange={(event) => updateContentForm("commerceScope", event.target.value)}
                    value={contentForm.commerceScope}
                  >
                    <option value="sellable_product">Produto principal</option>
                    <option value="included_content">Conteudo interno</option>
                    <option value="learning_content">Conteudo de apoio</option>
                  </select>
                </label>
                {showCourseLayoutSwitch ? (
                  <div className="rounded-[8px] border border-white/10 bg-black/20 p-3 lg:col-span-2">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-xs font-black uppercase text-zinc-500">Card unico</p>
                        <p className="mt-1 text-sm font-semibold leading-5 text-zinc-300">
                          {usesSingleCardLayout
                            ? "O card do curso abre direto a pagina de aula com modulos na playlist lateral."
                            : "O card do curso abre a pagina com cards de modulos antes das aulas."}
                        </p>
                      </div>
                      <button
                        aria-checked={usesSingleCardLayout}
                        aria-label="Ativar card unico para este curso"
                        className={`relative h-7 w-12 shrink-0 rounded-full border transition ${
                          usesSingleCardLayout
                            ? "border-emerald-400/30 bg-emerald-500"
                            : "border-white/15 bg-white/10"
                        }`}
                        onClick={() => updateContentForm(
                          "coursePresentationMode",
                          usesSingleCardLayout ? "module_cards" : "lesson_playlist"
                        )}
                        role="switch"
                        type="button"
                      >
                        <span
                          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-lg shadow-black/30 transition ${
                            usesSingleCardLayout ? "left-6" : "left-1"
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                ) : null}
                {showCourseLayoutSwitch ? (
                  <div className="rounded-[8px] border border-white/10 bg-black/20 p-3 lg:col-span-2">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-xs font-black uppercase text-zinc-500">Modulos na home</p>
                        <p className="mt-1 text-sm font-semibold leading-5 text-zinc-300">
                          {contentForm.homeModuleSectionEnabled
                            ? "A home mostra este curso com capa pequena e os modulos logo abaixo."
                            : "Opcao para catalogos curtos que precisam mostrar os modulos direto na home."}
                        </p>
                      </div>
                      <button
                        aria-checked={contentForm.homeModuleSectionEnabled}
                        aria-label="Exibir modulos deste curso na home"
                        className={`relative h-7 w-12 shrink-0 rounded-full border transition ${
                          contentForm.homeModuleSectionEnabled
                            ? "border-emerald-400/30 bg-emerald-500"
                            : "border-white/15 bg-white/10"
                        }`}
                        onClick={() => updateContentForm("homeModuleSectionEnabled", !contentForm.homeModuleSectionEnabled)}
                        role="switch"
                        type="button"
                      >
                        <span
                          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-lg shadow-black/30 transition ${
                            contentForm.homeModuleSectionEnabled ? "left-6" : "left-1"
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                ) : null}
                <label className="grid gap-1 text-xs font-black uppercase text-zinc-500">
                  Acesso
                  <select
                    className={inputClassName}
                    onChange={(event) => updateContentForm("accessModel", event.target.value)}
                    value={contentForm.accessModel}
                  >
                    <option value="closed">Fechado por acesso</option>
                    <option value="free">Gratuito para cadastro</option>
                  </select>
                </label>
                <div className="grid gap-3 lg:col-span-2 lg:grid-cols-[1fr_0.9fr]">
                  <label className="grid gap-1 text-xs font-black uppercase text-zinc-500">
                    Estudantes
                    <select
                      className={inputClassName}
                      onChange={(event) => updateContentForm("studentLimitMode", event.target.value)}
                      value={contentForm.studentLimitMode}
                    >
                      <option value="unlimited">Ilimitado</option>
                      <option value="limited">Limite maximo</option>
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs font-black uppercase text-zinc-500">
                    Limite
                    <input
                      className={inputClassName}
                      disabled={contentForm.studentLimitMode === "unlimited"}
                      min="1"
                      onChange={(event) => updateContentForm("maxStudents", event.target.value)}
                      placeholder="Ex: 100"
                      required={contentForm.studentLimitMode === "limited"}
                      type="number"
                      value={contentForm.maxStudents}
                    />
                  </label>
                </div>
                <label className="grid gap-1 text-xs font-black uppercase text-zinc-500">
                  Status
                  <select
                    className={inputClassName}
                    onChange={(event) => updateContentForm("status", event.target.value)}
                    value={contentForm.status}
                  >
                    <option>Novo</option>
                    <option>Liberado</option>
                    <option>Em andamento</option>
                    <option>Concluido</option>
                    <option>Bloqueado</option>
                    <option>Em breve</option>
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-black uppercase text-zinc-500 lg:col-span-2">
                  Liberacao
                  <select
                    className={inputClassName}
                    onChange={(event) => updateContentForm("releaseMode", event.target.value)}
                    value={contentForm.releaseMode}
                  >
                    <option value="immediate">Disponivel imediatamente</option>
                    <option value="after_enrollment">X dias apos inscricao</option>
                    <option value="fixed_date">Agendar data de publicacao</option>
                    <option value="after_purchase">Depois do entitlement</option>
                    <option value="after_previous_lesson">Depois da aula anterior</option>
                    <option value="activity_required">Atividade obrigatoria</option>
                  </select>
                </label>
                <div className="grid gap-3 lg:col-span-2 lg:grid-cols-2">
                  <label className="grid gap-1 text-xs font-black uppercase text-zinc-500">
                    Tempo
                    <input
                      className={inputClassName}
                      min="0"
                      onChange={(event) => updateContentForm("releaseDelayValue", event.target.value)}
                      placeholder="0"
                      type="number"
                      value={contentForm.releaseDelayValue}
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-black uppercase text-zinc-500">
                    Unidade
                    <select
                      className={inputClassName}
                      onChange={(event) => updateContentForm("releaseDelayUnit", event.target.value)}
                      value={contentForm.releaseDelayUnit}
                    >
                      <option value="horas">horas</option>
                      <option value="dias">dias</option>
                    </select>
                  </label>
                </div>
                <label className="grid gap-1 text-xs font-black uppercase text-zinc-500 lg:col-span-2">
                  Data agendada
                  <input
                    className={inputClassName}
                    onChange={(event) => updateContentForm("releaseFixedDate", event.target.value)}
                    type="datetime-local"
                    value={contentForm.releaseFixedDate}
                  />
                </label>
                <label className="grid gap-1 text-xs font-black uppercase text-zinc-500 lg:col-span-2">
                  Requisito
                  <input
                    className={inputClassName}
                    onChange={(event) => updateContentForm("releaseRequirement", event.target.value)}
                    placeholder="Ex: concluir aula anterior"
                    value={contentForm.releaseRequirement}
                  />
                </label>
                <label className="grid gap-1 text-xs font-black uppercase text-zinc-500 lg:col-span-6">
                  Descricao
                  <input
                    className={inputClassName}
                    onChange={(event) => updateContentForm("description", event.target.value)}
                    placeholder="Descricao curta da formacao, curso, mentoria, webinario ou produto"
                    value={contentForm.description}
                  />
                </label>
                <label className="grid gap-1 text-xs font-black uppercase text-zinc-500 lg:col-span-4">
                  Link de compra
                  <input
                    className={inputClassName}
                    onChange={(event) => updateContentForm("purchaseUrl", event.target.value)}
                    placeholder="https://..."
                    type="url"
                    value={contentForm.purchaseUrl}
                  />
                </label>
                <label className="grid gap-1 text-xs font-black uppercase text-zinc-500 lg:col-span-2">
                  Ao comprar
                  <select
                    className={inputClassName}
                    onChange={(event) => updateContentForm("lockedActionMode", event.target.value)}
                    value={contentForm.lockedActionMode}
                  >
                    <option value="details_modal">Abrir modal</option>
                    <option value="external_link">Abrir link externo</option>
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-black uppercase text-zinc-500 lg:col-span-2">
                  Abrir compra
                  <select
                    className={inputClassName}
                    onChange={(event) => updateContentForm("purchaseTarget", event.target.value)}
                    value={contentForm.purchaseTarget}
                  >
                    <option value="same_tab">Mesma aba</option>
                    <option value="new_tab">Nova aba</option>
                  </select>
                </label>
                <div className="grid gap-3 lg:col-span-3">
                  <label className="grid gap-1 text-xs font-black uppercase text-zinc-500">
                    Capa vertical do card
                    <input
                      accept="image/png,image/jpeg,image/webp"
                      className={`${inputClassName} h-auto py-2`}
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        event.currentTarget.value = "";
                        void handleImageUpload("image", file, posterImageSpec);
                      }}
                      type="file"
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-black uppercase text-zinc-500">
                    URL da capa
                    <input
                      className={inputClassName}
                      onChange={(event) => updateContentForm("image", event.target.value)}
                      placeholder={contentForm.image.startsWith("data:") ? "Imagem enviada do computador" : "https://..."}
                      value={contentForm.image.startsWith("data:") ? "" : contentForm.image}
                    />
                  </label>
                  <p className="text-xs font-semibold text-zinc-500">Padrao obrigatorio: {posterImageSpec.label}.</p>
                  {contentForm.image ? (
                    <div className="relative aspect-[720/1040] w-32 overflow-hidden rounded-[8px] border border-white/10 bg-black/30">
                      <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${contentForm.image})` }} />
                      <button
                        aria-label="Remover capa"
                        className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-full border border-white/15 bg-black/70 text-white shadow-xl shadow-black/40 transition hover:bg-red-600"
                        onClick={() => updateContentForm("image", "")}
                        type="button"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="grid gap-3 lg:col-span-3">
                  <label className="grid gap-1 text-xs font-black uppercase text-zinc-500">
                    Enviar hero do computador
                    <input
                      accept="image/png,image/jpeg,image/webp"
                      className={`${inputClassName} h-auto py-2`}
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        event.currentTarget.value = "";
                        void handleImageUpload("heroImage", file, heroImageSpec);
                      }}
                      type="file"
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-black uppercase text-zinc-500">
                    Ou usar URL da hero
                    <input
                      className={inputClassName}
                      onChange={(event) => updateContentForm("heroImage", event.target.value)}
                      placeholder={contentForm.heroImage.startsWith("data:") ? "Hero enviada do computador" : "https://..."}
                      value={contentForm.heroImage.startsWith("data:") ? "" : contentForm.heroImage}
                    />
                  </label>
                  <p className="text-xs font-semibold text-zinc-500">
                    Opcional. O envio pelo computador e o caminho principal. Padrao definido: {heroImageSpec.label}.
                  </p>
                  {contentForm.heroImage ? (
                    <div className="relative aspect-[1920/720] overflow-hidden rounded-[8px] border border-white/10 bg-black/30">
                      <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${contentForm.heroImage})` }} />
                      <button
                        aria-label="Remover hero"
                        className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-full border border-white/15 bg-black/70 text-white shadow-xl shadow-black/40 transition hover:bg-red-600"
                        onClick={() => updateContentForm("heroImage", "")}
                        type="button"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap justify-end gap-3 lg:col-span-6">
                  <button
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] border border-white/10 bg-white/[0.055] px-4 py-2 text-sm font-black text-zinc-200 transition hover:bg-white/10 hover:text-white"
                    onClick={() => setContentFormOpen(false)}
                    type="button"
                  >
                    Concluir depois
                  </button>
                  <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] bg-white px-4 py-2 text-sm font-black text-black transition hover:bg-zinc-200" type="submit">
                    <CheckCircle2 className="h-4 w-4" />
                    Salvar e continuar
                  </button>
                </div>
                </form>
              ) : null}

              {contentFormStep === "modules" ? (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
                <div className="rounded-[8px] border border-white/10 bg-black/20 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-black text-white">{wizardRecord?.content.title ?? "Item salvo"}</p>
                      <p className="mt-1 text-xs font-semibold text-zinc-500">
                        {wizardModules.length} modulo{wizardModules.length === 1 ? "" : "s"} cadastrado{wizardModules.length === 1 ? "" : "s"}.
                      </p>
                    </div>
                    <StatusPill className={getContentAccessModelClassName(wizardRecord?.content.accessModel)}>
                      {getContentAccessModelLabel(wizardRecord?.content.accessModel)}
                    </StatusPill>
                  </div>
                  {wizardModules.length > 0 ? (
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {wizardModules.map((module) => (
                        <div
                          className={`rounded-[8px] border p-3 transition ${
                            moduleBuilderForm.id === module.id
                              ? "border-white/30 bg-white/[0.08]"
                              : "border-white/10 bg-white/[0.045]"
                          }`}
                          key={module.id}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-black text-white">{module.title}</p>
                              <p className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-zinc-500">{module.description}</p>
                            </div>
                            <button
                              aria-label={`Editar modulo ${module.title}`}
                              className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] border border-white/10 bg-black/25 text-zinc-300 transition hover:bg-white/10 hover:text-white"
                              onClick={() => editWizardModule(module)}
                              type="button"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          </div>
                          <p className="mt-3 text-xs font-bold text-zinc-300">{module.lessons.length} aulas</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-[8px] border border-dashed border-white/12 p-6 text-center text-sm font-semibold text-zinc-500">
                      Crie o primeiro modulo, trilha ou bloco de entrega para este item.
                    </div>
                  )}
                </div>
                <form className="space-y-3 rounded-[8px] border border-white/10 bg-black/20 p-4" onSubmit={submitWizardModule}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-black text-white">{isEditingModule ? "Editar modulo" : "Novo modulo"}</p>
                    {isEditingModule ? (
                      <StatusPill className="border-white/10 bg-white/[0.06] text-zinc-300">Em edicao</StatusPill>
                    ) : null}
                  </div>
                  <label className="grid gap-2 text-sm font-bold text-zinc-400">
                    Nome do modulo
                    <input
                      className={inputClassName}
                      onChange={(event) => updateModuleBuilderForm("title", event.target.value)}
                      required
                      value={moduleBuilderForm.title}
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-bold text-zinc-400">
                    Capa do modulo
                    <input
                      accept="image/png,image/jpeg,image/webp"
                      className={`${inputClassName} h-auto py-2`}
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        event.currentTarget.value = "";
                        void handleModuleImageUpload(file);
                      }}
                      type="file"
                    />
                    <input
                      className={inputClassName}
                      onChange={(event) => updateModuleBuilderForm("image", event.target.value)}
                      placeholder={moduleBuilderForm.image.startsWith("data:") ? "Imagem enviada do computador" : "URL opcional"}
                      value={moduleBuilderForm.image.startsWith("data:") ? "" : moduleBuilderForm.image}
                    />
                  </label>
                  {moduleBuilderForm.image ? (
                    <div className="relative aspect-[720/1040] w-28 overflow-hidden rounded-[8px] border border-white/10 bg-black/30">
                      <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${moduleBuilderForm.image})` }} />
                      <button
                        aria-label="Remover capa do modulo"
                        className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-full border border-white/15 bg-black/70 text-white shadow-xl shadow-black/40 transition hover:bg-red-600"
                        onClick={() => updateModuleBuilderForm("image", "")}
                        type="button"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : null}
                  <label className="grid gap-2 text-sm font-bold text-zinc-400">
                    Descricao
                    <textarea
                      className={`${inputClassName} min-h-20 resize-none py-3`}
                      onChange={(event) => updateModuleBuilderForm("description", event.target.value)}
                      value={moduleBuilderForm.description}
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-bold text-zinc-400">
                    Liberacao do modulo
                    <select
                      className={inputClassName}
                      onChange={(event) => updateModuleBuilderForm("releaseMode", event.target.value)}
                      value={moduleBuilderForm.releaseMode}
                    >
                      <option value="immediate">Disponivel imediatamente</option>
                      <option value="after_enrollment">X dias apos inscricao</option>
                      <option value="fixed_date">Agendar publicacao</option>
                      <option value="after_purchase">Depois do entitlement</option>
                      <option value="after_previous_lesson">Depois do anterior</option>
                      <option value="activity_required">Atividade obrigatoria</option>
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="grid gap-2 text-sm font-bold text-zinc-400">
                      Tempo
                      <input
                        className={inputClassName}
                        min="0"
                        onChange={(event) => updateModuleBuilderForm("releaseDelayValue", event.target.value)}
                        placeholder="0"
                        type="number"
                        value={moduleBuilderForm.releaseDelayValue}
                      />
                    </label>
                    <label className="grid gap-2 text-sm font-bold text-zinc-400">
                      Unidade
                      <select
                        className={inputClassName}
                        onChange={(event) => updateModuleBuilderForm("releaseDelayUnit", event.target.value)}
                        value={moduleBuilderForm.releaseDelayUnit}
                      >
                        <option value="horas">horas</option>
                        <option value="dias">dias</option>
                      </select>
                    </label>
                  </div>
                  <label className="grid gap-2 text-sm font-bold text-zinc-400">
                    Data agendada
                    <input
                      className={inputClassName}
                      onChange={(event) => updateModuleBuilderForm("releaseFixedDate", event.target.value)}
                      type="datetime-local"
                      value={moduleBuilderForm.releaseFixedDate}
                    />
                  </label>
                  <button className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-[8px] bg-white px-4 py-2 text-sm font-black text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-45" disabled={!wizardRecord} type="submit">
                    {isEditingModule ? <CheckCircle2 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    {isEditingModule ? "Salvar modulo" : "Cadastrar modulo"}
                  </button>
                  {isEditingModule ? (
                    <button
                      className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-[8px] border border-white/10 bg-white/[0.055] px-4 py-2 text-sm font-black text-zinc-200 transition hover:bg-white/10 hover:text-white"
                      onClick={cancelWizardModuleEdit}
                      type="button"
                    >
                      Cancelar edicao
                    </button>
                  ) : null}
                  <button
                    className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-[8px] border border-white/10 bg-white/[0.055] px-4 py-2 text-sm font-black text-zinc-200 transition hover:bg-white/10 hover:text-white"
                    disabled={wizardModules.length === 0}
                    onClick={() => setContentFormStep("lessons")}
                    type="button"
                  >
                    Ir para aulas
                  </button>
                </form>
              </div>
              ) : null}

              {contentFormStep === "lessons" ? (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
                <div className="rounded-[8px] border border-white/10 bg-black/20 p-4">
                  <p className="text-sm font-black text-white">Aulas de {wizardRecord?.content.title ?? "conteudo"}</p>
                  <div className="mt-4 space-y-3">
                    {wizardModules.length === 0 ? (
                      <div className="rounded-[8px] border border-dashed border-white/12 p-6 text-center text-sm font-semibold text-zinc-500">
                        Cadastre um modulo antes de adicionar aulas.
                      </div>
                    ) : (
                      wizardModules.map((module) => (
                        <div className="rounded-[8px] border border-white/10 bg-white/[0.045] p-3" key={module.id}>
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-black text-white">{module.title}</p>
                            <StatusPill className="border-white/10 bg-black/25 text-zinc-300">{module.lessons.length} aulas</StatusPill>
                          </div>
                          {module.lessons.length > 0 ? (
                            <div className="mt-3 space-y-2">
                              {module.lessons.map((lesson) => (
                                <div
                                  className={`flex items-center justify-between gap-3 rounded-[6px] px-3 py-2 text-xs font-semibold transition ${
                                    lessonBuilderForm.id === lesson.id
                                      ? "bg-white/10 text-white"
                                      : "bg-black/25 text-zinc-300"
                                  }`}
                                  key={lesson.id}
                                >
                                  <div className="min-w-0">
                                    <p className="truncate">{lesson.title}</p>
                                    {lesson.duration ? (
                                      <p className="mt-1 text-[11px] font-bold text-zinc-500">{lesson.duration}</p>
                                    ) : null}
                                  </div>
                                  <button
                                    aria-label={`Editar aula ${lesson.title}`}
                                    className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] border border-white/10 bg-black/25 text-zinc-300 transition hover:bg-white/10 hover:text-white"
                                    onClick={() => editWizardLesson(module.id, lesson)}
                                    type="button"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <form className="space-y-3 rounded-[8px] border border-white/10 bg-black/20 p-4" onSubmit={submitWizardLesson}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-black text-white">{isEditingLesson ? "Editar aula" : "Nova aula"}</p>
                    {isEditingLesson ? (
                      <StatusPill className="border-white/10 bg-white/[0.06] text-zinc-300">Em edicao</StatusPill>
                    ) : null}
                  </div>
                  <label className="grid gap-2 text-sm font-bold text-zinc-400">
                    Modulo
                    <select
                      className={inputClassName}
                      disabled={wizardModules.length === 0}
                      onChange={(event) => updateLessonBuilderForm("moduleId", event.target.value)}
                      value={effectiveLessonModuleId}
                    >
                      {wizardModules.length === 0 ? <option value="">Cadastre um modulo primeiro</option> : null}
                      {wizardModules.map((module) => (
                        <option key={module.id} value={module.id}>{module.title}</option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-2 text-sm font-bold text-zinc-400">
                    Titulo da aula
                    <input
                      className={inputClassName}
                      onChange={(event) => updateLessonBuilderForm("title", event.target.value)}
                      required
                      value={lessonBuilderForm.title}
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-bold text-zinc-400">
                    Descricao da aula
                    <textarea
                      className={`${inputClassName} min-h-24 resize-none py-3`}
                      onChange={(event) => updateLessonBuilderForm("description", event.target.value)}
                      placeholder="Explique o que o aluno vai aprender nesta aula."
                      value={lessonBuilderForm.description}
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-bold text-zinc-400">
                    Duracao
                    <input
                      className={inputClassName}
                      onChange={(event) => updateLessonBuilderForm("duration", event.target.value)}
                      placeholder="Ex: 18 min ou 01:12:30"
                      value={lessonBuilderForm.duration}
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-bold text-zinc-400">
                    Thumbnail da aula
                    <input
                      className={inputClassName}
                      onChange={(event) => updateLessonBuilderForm("image", event.target.value)}
                      placeholder="URL opcional"
                      value={lessonBuilderForm.image}
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-bold text-zinc-400">
                    Player da aula
                    <select
                      className={inputClassName}
                      onChange={(event) => updateLessonBuilderForm("videoProvider", event.target.value)}
                      value={lessonBuilderForm.videoProvider}
                    >
                      {lessonVideoProviderOptions.map(([provider, label]) => (
                        <option key={provider} value={provider}>{label}</option>
                      ))}
                    </select>
                  </label>
                  {lessonBuilderForm.videoProvider === "embed_code" ? (
                    <label className="grid gap-2 text-sm font-bold text-zinc-400">
                      Codigo embed
                      <textarea
                        className={`${inputClassName} min-h-28 resize-none py-3 font-mono text-xs`}
                        onChange={(event) => updateLessonBuilderForm("videoEmbedCode", event.target.value)}
                        placeholder="<iframe ...></iframe>"
                        value={lessonBuilderForm.videoEmbedCode}
                      />
                    </label>
                  ) : (
                    <>
                      <label className="grid gap-2 text-sm font-bold text-zinc-400">
                        URL do video/player
                        <input
                          className={inputClassName}
                          onChange={(event) => updateLessonBuilderForm("videoUrl", event.target.value)}
                          placeholder="https://..."
                          value={lessonBuilderForm.videoUrl}
                        />
                      </label>
                      <label className="grid gap-2 text-sm font-bold text-zinc-400">
                        ID do asset
                        <input
                          className={inputClassName}
                          onChange={(event) => updateLessonBuilderForm("videoAssetId", event.target.value)}
                          placeholder="Opcional: id do YouTube, Vimeo, Bunny ou Mux"
                          value={lessonBuilderForm.videoAssetId}
                        />
                      </label>
                    </>
                  )}
                  <label className="grid gap-2 text-sm font-bold text-zinc-400">
                    Liberacao da aula
                    <select
                      className={inputClassName}
                      onChange={(event) => updateLessonBuilderForm("releaseMode", event.target.value)}
                      value={lessonBuilderForm.releaseMode}
                    >
                      <option value="immediate">Disponivel imediatamente</option>
                      <option value="after_enrollment">X dias apos inscricao</option>
                      <option value="fixed_date">Agendar publicacao</option>
                      <option value="after_purchase">Depois do entitlement</option>
                      <option value="after_previous_lesson">Depois do anterior</option>
                      <option value="activity_required">Atividade obrigatoria</option>
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="grid gap-2 text-sm font-bold text-zinc-400">
                      Tempo
                      <input
                        className={inputClassName}
                        min="0"
                        onChange={(event) => updateLessonBuilderForm("releaseDelayValue", event.target.value)}
                        placeholder="0"
                        type="number"
                        value={lessonBuilderForm.releaseDelayValue}
                      />
                    </label>
                    <label className="grid gap-2 text-sm font-bold text-zinc-400">
                      Unidade
                      <select
                        className={inputClassName}
                        onChange={(event) => updateLessonBuilderForm("releaseDelayUnit", event.target.value)}
                        value={lessonBuilderForm.releaseDelayUnit}
                      >
                        <option value="horas">horas</option>
                        <option value="dias">dias</option>
                      </select>
                    </label>
                  </div>
                  <label className="grid gap-2 text-sm font-bold text-zinc-400">
                    Data agendada
                    <input
                      className={inputClassName}
                      onChange={(event) => updateLessonBuilderForm("releaseFixedDate", event.target.value)}
                      type="datetime-local"
                      value={lessonBuilderForm.releaseFixedDate}
                    />
                  </label>
                  <button className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-[8px] bg-white px-4 py-2 text-sm font-black text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-45" disabled={!effectiveLessonModuleId} type="submit">
                    {isEditingLesson ? <CheckCircle2 className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    {isEditingLesson ? "Salvar aula" : "Cadastrar aula"}
                  </button>
                  {isEditingLesson ? (
                    <button
                      className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-[8px] border border-white/10 bg-white/[0.055] px-4 py-2 text-sm font-black text-zinc-200 transition hover:bg-white/10 hover:text-white"
                      onClick={cancelWizardLessonEdit}
                      type="button"
                    >
                      Cancelar edicao
                    </button>
                  ) : null}
                  <button
                    className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-[8px] border border-white/10 bg-white/[0.055] px-4 py-2 text-sm font-black text-zinc-200 transition hover:bg-white/10 hover:text-white"
                    onClick={() => setContentFormOpen(false)}
                    type="button"
                  >
                    Finalizar por enquanto
                  </button>
                </form>
              </div>
              ) : null}
            </div>
          </DialogContent>
        </Dialog>

        <CatalogTable
          filteredRecords={filteredRecords}
          onDeleteRecord={deleteRecord}
          onEditRecord={openEditContentForm}
          onSelectRecord={setSelectedRecord}
          selectedRecord={selectedRecord}
        />
      </section>

      <SelectedContentPanel
        onDeleteRecord={deleteRecord}
        onEditRecord={openEditContentForm}
        selectedRecord={selectedRecord}
      />
    </div>
  );
}

type PersonalizationTarget =
  | { kind: "index" }
  | { kind: "showcase" }
  | { kind: "login" }
  | { kind: "products" }
  | { kind: "content"; recordId: string };

type ContentEditorPanel = "page" | "structure";
type LoginEditorSection = "template" | "image" | "form" | "providers";
type ProductsEditorSection = "header" | "filters" | "cards";

type HomeSectionDraft = {
  contentCount: number;
  id: string;
  order: number;
  source: string;
  title: string;
  visibility: AdminHomeSection["visibility"];
};

type LoginDraft = {
  backgroundImage: string;
  subtitle: string;
  template: LoginTemplateId;
  title: string;
};

function getVisibilityLabel(visibility: AdminHomeSection["visibility"]) {
  if (visibility === "students") {
    return "Alunos com acesso";
  }

  if (visibility === "non_students") {
    return "Sem compra ativa";
  }

  return "Todos";
}

function getSelectedRecordModules(records: AdminContentRecord[], modules: CourseModule[], selectedRecord?: AdminContentRecord) {
  if (!selectedRecord) {
    return [] as CourseModule[];
  }

  const scopedModules = modules.filter((module) => module.ownerId === selectedRecord.content.id);

  if (scopedModules.length > 0) {
    return scopedModules;
  }

  const hasScopedModules = modules.some((module) => module.ownerId);
  const recordUsesSharedSeed = records.length <= 1 || !hasScopedModules;

  return recordUsesSharedSeed ? modules : [];
}

function PersonalizationEditorHeader({
  eyebrow,
  onBack,
  title
}: {
  eyebrow: string;
  onBack: () => void;
  title: string;
}) {
  return (
    <div className="sticky top-[4.25rem] z-30 -mx-4 border-y border-white/10 bg-[#0b0b0b]/94 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-white/10 bg-white/[0.055] px-3 text-xs font-black text-zinc-200 transition hover:bg-white/10 hover:text-white"
            onClick={onBack}
            type="button"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </button>
          <div className="min-w-0">
            <p className="text-xs font-black uppercase text-zinc-500">{eyebrow}</p>
            <h2 className="truncate text-xl font-black text-white">{title}</h2>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="inline-flex h-10 items-center rounded-[8px] border border-white/10 bg-white/[0.055] px-3 text-xs font-black text-zinc-300 transition hover:bg-white/10 hover:text-white" type="button">
            Descartar
          </button>
          <button className="inline-flex h-10 items-center rounded-[8px] bg-white px-3 text-xs font-black text-black transition hover:bg-zinc-200" type="button">
            Publicar
          </button>
        </div>
      </div>
    </div>
  );
}

function PersonalizationView({
  courseModules,
  formationCourses,
  hero,
  homeSections,
  homeRows,
  records
}: {
  courseModules: CourseModule[];
  formationCourses: AdminDashboardData["formationCourses"];
  hero: AdminDashboardData["hero"];
  homeSections: AdminHomeSection[];
  homeRows: HomeRow[];
  records: AdminContentRecord[];
}) {
  const sellableRecords = records.filter((record) => record.commerceScope === "sellable_product");
  const visiblePreviewRecords = sellableRecords.length > 0 ? sellableRecords : records;
  const firstSellableRecord = visiblePreviewRecords[0];
  const defaultLoginConfig = getLoginPageConfig();
  const [activeTarget, setActiveTarget] = useState<PersonalizationTarget>({ kind: "index" });
  const [contentEditorPanel, setContentEditorPanel] = useState<ContentEditorPanel>("page");
  const [loginEditorSection, setLoginEditorSection] = useState<LoginEditorSection>("template");
  const [productsEditorSection, setProductsEditorSection] = useState<ProductsEditorSection>("header");
  const [selectedRecordId, setSelectedRecordId] = useState(firstSellableRecord?.content.id ?? "");
  const activeRecordId = activeTarget.kind === "content" ? activeTarget.recordId : selectedRecordId;
  const selectedRecord =
    records.find((record) => record.content.id === activeRecordId) ??
    firstSellableRecord;
  const selectedModules = getSelectedRecordModules(records, courseModules, selectedRecord);
  const [homeSectionDrafts] = useState<HomeSectionDraft[]>(() => (
    homeRows.length > 0
      ? homeRows.map((row, index) => ({
          contentCount: row.variant === "course_modules" ? row.modules?.length ?? 0 : row.items.length,
          id: row.id,
          order: index + 1,
          source:
            row.variant === "continue"
              ? "Progresso do aluno"
              : row.variant === "course_modules"
                ? "Modulos de curso escolhido"
                : row.visibility === "students"
                  ? "Entitlements ativos"
                  : "Curadoria persistida",
          title: row.title,
          visibility: row.visibility
        }))
      : homeSections.length > 0
        ? homeSections.map((section) => ({ ...section }))
      : [
          {
            contentCount: visiblePreviewRecords.length,
            id: "showcase",
            order: 1,
            source: "Produtos principais",
            title: "Vitrine",
            visibility: "all"
          }
        ]
  ));
  const [selectedSectionId, setSelectedSectionId] = useState(homeRows[0]?.id ?? homeSections[0]?.id ?? "showcase");
  const [loginDraft, setLoginDraft] = useState<LoginDraft>({
    backgroundImage: defaultLoginConfig.visual.imageSrc,
    subtitle: defaultLoginConfig.form.subtitle,
    template: defaultLoginConfig.template,
    title: defaultLoginConfig.form.title
  });
  const loginPreviewConfig = useMemo<LoginPageConfig>(() => {
    const baseConfig = getLoginPageConfig(loginDraft.template);

    return {
      ...baseConfig,
      form: {
        ...baseConfig.form,
        subtitle: loginDraft.subtitle,
        title: loginDraft.title
      },
      visual: {
        ...baseConfig.visual,
        imageSrc: loginDraft.backgroundImage
      }
    };
  }, [loginDraft]);
  const selectedSection =
    homeSectionDrafts.find((section) => section.id === selectedSectionId) ??
    homeSectionDrafts[0];
  const personalizationItemsCount = visiblePreviewRecords.length + 3;

  function openContentEditor(record: AdminContentRecord, panel: ContentEditorPanel = "page") {
    setSelectedRecordId(record.content.id);
    setContentEditorPanel(panel);
    setActiveTarget({ kind: "content", recordId: record.content.id });
  }

  function selectContentRecord(recordId: string) {
    setSelectedRecordId(recordId);
    setActiveTarget({ kind: "content", recordId });
  }

  function getActiveEditorTitle() {
    if (activeTarget.kind === "showcase") {
      return "Vitrine";
    }

    if (activeTarget.kind === "login") {
      return "Pagina de login";
    }

    if (activeTarget.kind === "products") {
      return "Pagina de produtos";
    }

    if (activeTarget.kind === "content") {
      return selectedRecord?.content.title ?? "Produto";
    }

    return "Personalizacao";
  }

  function renderPersonalizationIndex() {
    return (
      <PersonalizationCommandCenter
        onOpenContent={openContentEditor}
        onOpenLogin={() => setActiveTarget({ kind: "login" })}
        onOpenProducts={() => setActiveTarget({ kind: "products" })}
        onOpenShowcase={() => setActiveTarget({ kind: "showcase" })}
        personalizationItemsCount={personalizationItemsCount}
        records={records}
        visiblePreviewRecords={visiblePreviewRecords}
      />
    );
  }

  function renderShowcasePersonalization() {
    return (
      <section className="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className={`${panelClassName} h-fit overflow-hidden`}>
          <div className="border-b border-white/10 p-4">
            <p className="text-sm font-black text-white">Vitrine</p>
          </div>
          <div className="space-y-3 p-3">
            <button className="flex min-h-11 w-full items-center justify-between rounded-[8px] border border-white/10 bg-white/[0.055] px-3 text-left text-sm font-bold text-zinc-200 transition hover:bg-white/10 hover:text-white" type="button">
              Banner
              <Pencil className="h-4 w-4" />
            </button>
            <div className="rounded-[8px] border border-white/10 bg-black/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-bold text-white">Secoes</p>
                <button className="inline-flex min-h-8 items-center gap-2 rounded-[7px] border border-white/10 bg-white/[0.055] px-2.5 text-xs font-black text-zinc-200 transition hover:bg-white/10 hover:text-white" type="button">
                  <Plus className="h-4 w-4" />
                  Criar
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {homeSectionDrafts
                  .slice()
                  .sort((first, second) => first.order - second.order)
                  .map((section) => {
                    const isSelected = section.id === selectedSection?.id;

                    return (
                      <button
                        className={`flex w-full items-center gap-2 rounded-[8px] border px-3 py-2 text-left transition ${
                          isSelected
                            ? "border-white/25 bg-white text-black"
                            : "border-white/10 bg-white/[0.035] text-zinc-300 hover:bg-white/10 hover:text-white"
                        }`}
                        key={section.id}
                        onClick={() => setSelectedSectionId(section.id)}
                        type="button"
                      >
                        <Menu className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-black">{section.title}</span>
                          <span className={`mt-1 block text-[11px] font-semibold ${isSelected ? "text-black/55" : "text-zinc-500"}`}>
                            {section.contentCount} item{section.contentCount === 1 ? "" : "s"} / {getVisibilityLabel(section.visibility)}
                          </span>
                        </span>
                        <MoreHorizontal className="h-4 w-4 shrink-0" />
                      </button>
                    );
                  })}
              </div>
            </div>
          </div>
        </aside>

        <div className="relative min-w-0 overflow-hidden rounded-[8px] border border-white/10 bg-[#141414] shadow-2xl shadow-black/20">
          <div className="absolute left-0 right-0 top-0 z-30 flex h-16 items-center gap-4 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.72),rgba(0,0,0,0.08))] px-4 sm:px-6">
            <button
              aria-label="Abrir menu"
              className="grid h-10 w-10 place-items-center rounded-[6px] text-white transition hover:bg-white/10"
              type="button"
            >
              <Menu className="h-5 w-5" />
            </button>
            <Image alt="Bunker707" className="h-auto w-[150px] sm:w-[190px]" height={35} src="/brand/logo-bunker.svg" unoptimized width={306} />
            <div className="ml-auto flex items-center gap-2">
              <button aria-label="Buscar" className="grid h-10 w-10 place-items-center rounded-[6px] text-white transition hover:bg-white/10" type="button">
                <Search className="h-5 w-5" />
              </button>
              <button aria-label="Notificacoes" className="grid h-10 w-10 place-items-center rounded-[6px] text-white transition hover:bg-white/10" type="button">
                <Bell className="h-5 w-5" />
              </button>
              <span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--accent)] text-xs font-black text-white">
                DS
              </span>
            </div>
          </div>

          <div className="group/banner relative">
            <HeroSection hero={hero} />
            <button className="absolute right-5 top-20 z-40 inline-flex min-h-9 items-center gap-2 rounded-[8px] border border-white/15 bg-black/55 px-3 py-2 text-xs font-black text-white opacity-100 backdrop-blur transition hover:bg-white hover:text-black sm:opacity-0 sm:group-hover/banner:opacity-100" type="button">
              <Pencil className="h-4 w-4" />
              Editar banner
            </button>
          </div>

          <div className="relative z-20 -mt-24 space-y-20 pb-24">
            {homeRows.length > 0 ? (
              homeRows.map((row) => (
                <div
                  className={`group/section relative rounded-[8px] transition ${
                    row.id === selectedSection?.id ? "outline outline-1 outline-white/20" : "outline outline-1 outline-transparent"
                  }`}
                  key={row.id}
                >
                  <button
                    className="absolute right-5 top-0 z-40 inline-flex min-h-9 items-center gap-2 rounded-[8px] border border-white/10 bg-black/55 px-3 py-2 text-xs font-black text-zinc-100 opacity-100 backdrop-blur transition hover:bg-white hover:text-black sm:opacity-0 sm:group-hover/section:opacity-100"
                    onClick={() => setSelectedSectionId(row.id)}
                    type="button"
                  >
                    <Pencil className="h-4 w-4" />
                    Editar secao
                  </button>
                  {row.variant === "course_modules" && row.course && row.modules ? (
                    <CourseModulesHomeSection
                      course={row.course}
                      lockedActionMode={row.lockedActionMode}
                      modules={row.modules}
                      subtitle={row.subtitle}
                      title={row.title}
                    />
                  ) : (
                    <ContentRow
                      items={row.items}
                      subtitle={row.subtitle}
                      title={row.title}
                      variant={row.variant === "continue" ? "continue" : "vertical"}
                    />
                  )}
                </div>
              ))
            ) : (
              <div className="group/section relative">
                <button className="absolute right-5 top-0 z-40 inline-flex min-h-9 items-center gap-2 rounded-[8px] border border-white/10 bg-black/55 px-3 py-2 text-xs font-black text-zinc-100 backdrop-blur transition hover:bg-white hover:text-black" type="button">
                  <Pencil className="h-4 w-4" />
                  Editar secao
                </button>
                <ContentRow
                  items={visiblePreviewRecords.map((record) => record.content)}
                  title="Vitrine"
                  variant="vertical"
                />
              </div>
            )}
          </div>

          <MemberFooter />
        </div>
      </section>
    );
  }

  function renderLoginPersonalization() {
    return (
      <section className="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className={`${panelClassName} h-fit overflow-hidden`}>
          <div className="border-b border-white/10 p-4">
            <p className="text-sm font-black text-white">Pagina de login</p>
          </div>
          <div className="space-y-3 p-3">
            {[
              ["template", "Template", "Modelo e posicao do formulario"],
              ["image", "Imagem", "Visual lateral ou fundo"],
              ["form", "Formulario", "Titulo, texto e CTA"],
              ["providers", "Provedores", "Login social e links"]
            ].map(([id, label, description]) => {
              const isSelected = loginEditorSection === id;

              return (
                <button
                  className={`w-full rounded-[8px] border px-3 py-2 text-left transition ${
                    isSelected
                      ? "border-white/25 bg-white text-black"
                      : "border-white/10 bg-white/[0.035] text-zinc-300 hover:bg-white/10 hover:text-white"
                  }`}
                  key={id}
                  onClick={() => setLoginEditorSection(id as LoginEditorSection)}
                  type="button"
                >
                  <span className="block text-sm font-black">{label}</span>
                  <span className={`mt-1 block text-[11px] font-semibold ${isSelected ? "text-black/55" : "text-zinc-500"}`}>
                    {description}
                  </span>
                </button>
              );
            })}

            {loginEditorSection === "template" ? (
              <div className="rounded-[8px] border border-white/10 bg-black/20 p-3">
                <p className="text-xs font-black uppercase text-zinc-500">Modelos</p>
                <div className="mt-3 grid gap-2">
                  {loginTemplateOptions.map((template) => (
                    <button
                      className={`rounded-[8px] border px-3 py-2 text-left text-xs font-black transition ${
                        loginDraft.template === template.id
                          ? "border-white/20 bg-white text-black"
                          : "border-white/10 bg-white/[0.035] text-zinc-300 hover:bg-white/10 hover:text-white"
                      }`}
                      key={template.id}
                      onClick={() => setLoginDraft((current) => ({ ...current, template: template.id }))}
                      type="button"
                    >
                      {template.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {loginEditorSection === "form" ? (
              <div className="space-y-3 rounded-[8px] border border-white/10 bg-black/20 p-3">
                <label className="grid gap-1 text-xs font-black uppercase text-zinc-500">
                  Titulo opcional
                  <input
                    className={inputClassName}
                    onChange={(event) => setLoginDraft((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Sem titulo por padrao"
                    value={loginDraft.title}
                  />
                </label>
                <label className="grid gap-1 text-xs font-black uppercase text-zinc-500">
                  Texto opcional
                  <textarea
                    className={`${inputClassName} min-h-20 resize-none py-3`}
                    onChange={(event) => setLoginDraft((current) => ({ ...current, subtitle: event.target.value }))}
                    placeholder="Sem texto por padrao"
                    value={loginDraft.subtitle}
                  />
                </label>
              </div>
            ) : null}
          </div>
        </aside>

        <div className="relative min-w-0 overflow-hidden rounded-[8px] border border-white/10 bg-black shadow-2xl shadow-black/20">
          <button className="absolute right-5 top-5 z-30 inline-flex min-h-9 items-center gap-2 rounded-[8px] border border-white/15 bg-black/55 px-3 py-2 text-xs font-black text-white backdrop-blur transition hover:bg-white hover:text-black" type="button">
            <Pencil className="h-4 w-4" />
            Editar area selecionada
          </button>
          <div className="pointer-events-none">
            <LoginExperience
              authConfigured={false}
              config={loginPreviewConfig}
              redirectTo="/"
            />
          </div>
        </div>
      </section>
    );
  }

  function renderProductsPagePersonalization() {
    return (
      <section className="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className={`${panelClassName} h-fit overflow-hidden`}>
          <div className="border-b border-white/10 p-4">
            <p className="text-sm font-black text-white">Pagina de produtos</p>
          </div>
          <div className="space-y-3 p-3">
            {[
              ["header", "Cabecalho", "Titulo e resumo da lista"],
              ["filters", "Filtros", "Abas e busca"],
              ["cards", "Cards", "Tamanho e informacoes visiveis"]
            ].map(([id, label, description]) => {
              const isSelected = productsEditorSection === id;

              return (
                <button
                  className={`w-full rounded-[8px] border px-3 py-2 text-left transition ${
                    isSelected
                      ? "border-white/25 bg-white text-black"
                      : "border-white/10 bg-white/[0.035] text-zinc-300 hover:bg-white/10 hover:text-white"
                  }`}
                  key={id}
                  onClick={() => setProductsEditorSection(id as ProductsEditorSection)}
                  type="button"
                >
                  <span className="block text-sm font-black">{label}</span>
                  <span className={`mt-1 block text-[11px] font-semibold ${isSelected ? "text-black/55" : "text-zinc-500"}`}>
                    {description}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="relative min-w-0 overflow-hidden rounded-[8px] border border-white/10 bg-[#141414] shadow-2xl shadow-black/20">
          <div className="absolute left-0 right-0 top-0 z-20 flex h-16 items-center gap-4 bg-[#080808]/92 px-4 sm:px-6">
            <button aria-label="Abrir menu" className="grid h-10 w-10 place-items-center rounded-[6px] text-white transition hover:bg-white/10" type="button">
              <Menu className="h-5 w-5" />
            </button>
            <Image alt="Bunker707" className="h-auto w-[150px] sm:w-[190px]" height={35} src="/brand/logo-bunker.svg" unoptimized width={306} />
          </div>
          <button className="absolute right-5 top-20 z-30 inline-flex min-h-9 items-center gap-2 rounded-[8px] border border-white/15 bg-black/55 px-3 py-2 text-xs font-black text-white backdrop-blur transition hover:bg-white hover:text-black" type="button">
            <Pencil className="h-4 w-4" />
            Editar area selecionada
          </button>
          <div className="pointer-events-none">
            <PurchasesExperience items={visiblePreviewRecords.map((record) => record.content)} />
          </div>
          <MemberFooter />
        </div>
      </section>
    );
  }

  function renderContentPersonalization() {
    if (!selectedRecord) {
      return (
        <section className={`${panelClassName} p-8 text-center`}>
          <LibraryBig className="mx-auto h-8 w-8 text-zinc-600" />
          <p className="mt-3 text-lg font-black text-white">Crie um produto no Catalogo primeiro.</p>
        </section>
      );
    }

    const heroSettings = selectedRecord.pageSettings?.hero;
    const pageHero = {
      badge: heroSettings?.badge ?? selectedRecord.content.accessLabel ?? selectedRecord.kind,
      ctaHref: heroSettings?.ctaHref ?? "#conteudos",
      ctaLabel: heroSettings?.ctaLabel ?? "Acessar",
      description: heroSettings?.description ?? selectedRecord.content.description,
      mediaSrc: heroSettings?.mediaSrc ?? selectedRecord.content.image ?? hero.image,
      mediaType: heroSettings?.mediaType ?? "image",
      poster: heroSettings?.poster,
      title: heroSettings?.title ?? selectedRecord.content.title,
      visibility: {
        badge: heroSettings?.visibility?.badge ?? false,
        cta: heroSettings?.visibility?.cta ?? false,
        description: heroSettings?.visibility?.description ?? false,
        title: heroSettings?.visibility?.title ?? false
      }
    };
    const showBadge = Boolean(pageHero.visibility.badge && pageHero.badge);
    const showTitle = Boolean(pageHero.visibility.title && pageHero.title);
    const showDescription = Boolean(pageHero.visibility.description && pageHero.description);
    const showCta = Boolean(pageHero.visibility.cta && pageHero.ctaLabel);
    const hasVisibleHeroContent = showBadge || showTitle || showDescription || showCta;

    return (
      <section className="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className={`${panelClassName} h-fit overflow-hidden`}>
          <div className="border-b border-white/10 p-4">
            <p className="text-sm font-black text-white">Produto</p>
          </div>
          <div className="space-y-3 p-3">
            <label className="grid gap-2 text-xs font-black uppercase text-zinc-500">
              Pagina
              <select
                className={inputClassName}
                onChange={(event) => selectContentRecord(event.target.value)}
                value={selectedRecord.content.id}
              >
                {visiblePreviewRecords.map((record) => (
                  <option key={record.content.id} value={record.content.id}>
                    {record.content.title}
                  </option>
                ))}
              </select>
            </label>

            {[
              ["page", "Pagina do produto", "Hero, imagem e secoes da pagina"],
              ["structure", "Modulos e cards", "Como cursos, modulos e aulas aparecem"]
            ].map(([id, label, description]) => {
              const isSelected = contentEditorPanel === id;

              return (
                <button
                  className={`w-full rounded-[8px] border px-3 py-2 text-left transition ${
                    isSelected
                      ? "border-white/25 bg-white text-black"
                      : "border-white/10 bg-white/[0.035] text-zinc-300 hover:bg-white/10 hover:text-white"
                  }`}
                  key={id}
                  onClick={() => setContentEditorPanel(id as ContentEditorPanel)}
                  type="button"
                >
                  <span className="block text-sm font-black">{label}</span>
                  <span className={`mt-1 block text-[11px] font-semibold ${isSelected ? "text-black/55" : "text-zinc-500"}`}>
                    {description}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="relative min-w-0 overflow-hidden rounded-[8px] border border-white/10 bg-[#141414] shadow-2xl shadow-black/20">
          <div className="absolute left-0 right-0 top-0 z-20 flex h-16 items-center gap-4 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.72),rgba(0,0,0,0.08))] px-4 sm:px-6">
            <button aria-label="Abrir menu" className="grid h-10 w-10 place-items-center rounded-[6px] text-white transition hover:bg-white/10" type="button">
              <Menu className="h-5 w-5" />
            </button>
            <Image alt="Bunker707" className="h-auto w-[150px] sm:w-[190px]" height={35} src="/brand/logo-bunker.svg" unoptimized width={306} />
          </div>

          <section
            className={`group/hero relative min-h-[640px] overflow-hidden transition ${
              contentEditorPanel === "page" ? "outline outline-1 outline-white/20" : "outline outline-1 outline-transparent"
            }`}
          >
            {pageHero.mediaType === "video" ? (
              <video
                aria-hidden="true"
                autoPlay
                className="absolute inset-0 h-full w-full object-cover"
                loop
                muted
                playsInline
                poster={pageHero.poster}
                src={pageHero.mediaSrc}
              />
            ) : (
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={{ backgroundImage: `url(${pageHero.mediaSrc})` }}
              />
            )}
            {hasVisibleHeroContent ? (
              <div className="absolute inset-0 bg-gradient-to-r from-black via-black/72 to-black/18" />
            ) : null}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-gradient-to-b from-transparent via-[#141414]/88 to-[#141414]" />
            <button
              className="absolute right-5 top-20 z-30 inline-flex min-h-9 items-center gap-2 rounded-[8px] border border-white/15 bg-black/55 px-3 py-2 text-xs font-black text-white opacity-100 backdrop-blur transition hover:bg-white hover:text-black sm:opacity-0 sm:group-hover/hero:opacity-100"
              onClick={() => setContentEditorPanel("page")}
              type="button"
            >
              <Pencil className="h-4 w-4" />
              Editar hero
            </button>

            <div className="relative z-10 flex min-h-[640px] max-w-6xl flex-col px-5 pb-36 pt-24 sm:px-8 lg:px-12">
              <div className="mt-auto">
                {showBadge ? (
                  <div className="mb-4 inline-flex w-fit items-center gap-2 rounded-[6px] border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-normal text-white backdrop-blur">
                    <BookOpen className="h-4 w-4 text-[var(--accent-warm)]" />
                    {pageHero.badge}
                  </div>
                ) : null}

                {showTitle ? (
                  <h1 className="max-w-4xl text-5xl font-black leading-none text-white sm:text-6xl lg:text-7xl">
                    {pageHero.title}
                  </h1>
                ) : (
                  <h1 className="sr-only">{selectedRecord.content.title}</h1>
                )}

                {showDescription ? (
                  <p className="mt-6 max-w-2xl text-base leading-7 text-zinc-200 sm:text-lg">
                    {pageHero.description}
                  </p>
                ) : null}

                {showCta ? (
                  <div className="mt-8">
                    <span className="inline-flex min-h-12 items-center gap-2 rounded-[8px] bg-white px-6 py-3 text-sm font-extrabold text-black">
                      <Play className="h-4 w-4 fill-current" />
                      {pageHero.ctaLabel}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <div
            className={`group/structure relative z-20 -mt-28 transition sm:-mt-32 ${
              contentEditorPanel === "structure" ? "outline outline-1 outline-white/20" : "outline outline-1 outline-transparent"
            }`}
          >
            <button
              className="absolute right-5 top-0 z-30 inline-flex min-h-9 items-center gap-2 rounded-[8px] border border-white/15 bg-black/55 px-3 py-2 text-xs font-black text-white opacity-100 backdrop-blur transition hover:bg-white hover:text-black sm:opacity-0 sm:group-hover/structure:opacity-100"
              onClick={() => setContentEditorPanel("structure")}
              type="button"
            >
              <Pencil className="h-4 w-4" />
              Editar modulos
            </button>
            <div className="pointer-events-none">
              <ContentStructureSection
                formationCourseOpenMode={selectedRecord.pageSettings?.formationCourseOpenMode ?? "course_lesson_format"}
                formationCourses={selectedRecord.kind === "Formacao" ? formationCourses : []}
                internalCardActionMode={selectedRecord.pageSettings?.internalCardActionMode ?? "implicit"}
                item={selectedRecord.content}
                modules={selectedModules}
                showLockedStates={false}
              />
            </div>
          </div>
          <MemberFooter />
        </div>
      </section>
    );
  }

  if (activeTarget.kind === "index") {
    return renderPersonalizationIndex();
  }

  return (
    <div className="space-y-4">
      <PersonalizationEditorHeader
        eyebrow="Personalizacao"
        onBack={() => setActiveTarget({ kind: "index" })}
        title={getActiveEditorTitle()}
      />
      <div className="min-w-0">
        {activeTarget.kind === "showcase" ? renderShowcasePersonalization() : null}
        {activeTarget.kind === "login" ? renderLoginPersonalization() : null}
        {activeTarget.kind === "products" ? renderProductsPagePersonalization() : null}
        {activeTarget.kind === "content" ? renderContentPersonalization() : null}
      </div>
    </div>
  );
}

function StructureView({
  cohorts,
  courseModules,
  onDashboardDataChange,
  selectedRecord
}: {
  cohorts: string[];
  courseModules: CourseModule[];
  onDashboardDataChange: (data: AdminDashboardData) => void;
  selectedRecord?: AdminContentRecord;
}) {
  const [moduleTitle, setModuleTitle] = useState("");
  const [moduleDescription, setModuleDescription] = useState("");
  const [moduleImage, setModuleImage] = useState("");
  const [moduleReleaseMode, setModuleReleaseMode] = useState<AdminReleaseRule["mode"]>("immediate");
  const [moduleReleaseDelayValue, setModuleReleaseDelayValue] = useState("");
  const [moduleReleaseDelayUnit, setModuleReleaseDelayUnit] = useState<"horas" | "dias">("dias");
  const [moduleReleaseFixedDate, setModuleReleaseFixedDate] = useState("");
  const [lessonTitle, setLessonTitle] = useState("");
  const [lessonDescription, setLessonDescription] = useState("");
  const [lessonDuration, setLessonDuration] = useState("");
  const [lessonImage, setLessonImage] = useState("");
  const [lessonModuleId, setLessonModuleId] = useState(courseModules[0]?.id ?? "");
  const [lessonReleaseMode, setLessonReleaseMode] = useState<AdminReleaseRule["mode"]>("immediate");
  const [lessonReleaseDelayValue, setLessonReleaseDelayValue] = useState("");
  const [lessonReleaseDelayUnit, setLessonReleaseDelayUnit] = useState<"horas" | "dias">("dias");
  const [lessonReleaseFixedDate, setLessonReleaseFixedDate] = useState("");
  const [lessonVideoProvider, setLessonVideoProvider] = useState<LessonVideoProvider>("youtube");
  const [lessonVideoUrl, setLessonVideoUrl] = useState("");
  const [lessonVideoAssetId, setLessonVideoAssetId] = useState("");
  const [lessonVideoEmbedCode, setLessonVideoEmbedCode] = useState("");
  const [cohortName, setCohortName] = useState("");
  const selectedOwnerModules = useMemo(() => {
    if (!selectedRecord) {
      return [] as CourseModule[];
    }

    const scopedModules = courseModules.filter((module) => module.ownerId === selectedRecord.content.id);

    if (scopedModules.length > 0) {
      return scopedModules;
    }

    const hasScopedModules = courseModules.some((module) => module.ownerId);
    return hasScopedModules ? [] : courseModules;
  }, [courseModules, selectedRecord]);
  const effectiveLessonModuleId = selectedOwnerModules.some((module) => module.id === lessonModuleId)
    ? lessonModuleId
    : selectedOwnerModules[0]?.id ?? "";

  async function postDashboardMutation(endpoint: string, payload: Record<string, unknown>) {
    const response = await fetch(endpoint, {
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const result = await response.json() as { data?: AdminDashboardData; error?: string };

    if (!response.ok || !result.data) {
      throw new Error(result.error ?? "Nao foi possivel salvar.");
    }

    onDashboardDataChange(result.data);
  }

  async function submitModule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedRecord) {
      return;
    }

    await postDashboardMutation("/api/admin/modules", {
      description: moduleDescription,
      image: moduleImage,
      ownerId: selectedRecord.content.id,
      ownerKind: selectedRecord.kind,
      releaseFixedDate: moduleReleaseFixedDate,
      releaseDelayUnit: moduleReleaseDelayUnit,
      releaseDelayValue: moduleReleaseDelayValue,
      releaseMode: moduleReleaseMode,
      title: moduleTitle
    });
    setModuleTitle("");
    setModuleDescription("");
    setModuleImage("");
    setModuleReleaseDelayValue("");
    setModuleReleaseFixedDate("");
    setModuleReleaseMode("immediate");
  }

  async function submitLesson(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selectedModuleId = effectiveLessonModuleId;

    if (!selectedModuleId) {
      return;
    }

    await postDashboardMutation("/api/admin/lessons", {
      description: lessonDescription,
      duration: lessonDuration,
      moduleId: selectedModuleId,
      image: lessonImage,
      releaseFixedDate: lessonReleaseFixedDate,
      releaseDelayUnit: lessonReleaseDelayUnit,
      releaseDelayValue: lessonReleaseDelayValue,
      releaseMode: lessonReleaseMode,
      title: lessonTitle,
      video: buildLessonVideoConfig({
        ...emptyLessonBuilderFormState,
        videoAssetId: lessonVideoAssetId,
        videoEmbedCode: lessonVideoEmbedCode,
        videoProvider: lessonVideoProvider,
        videoUrl: lessonVideoUrl
      }) ?? null
    });
    setLessonTitle("");
    setLessonDescription("");
    setLessonDuration("");
    setLessonImage("");
    setLessonReleaseDelayValue("");
    setLessonReleaseFixedDate("");
    setLessonReleaseMode("immediate");
    setLessonVideoAssetId("");
    setLessonVideoEmbedCode("");
    setLessonVideoProvider("youtube");
    setLessonVideoUrl("");
  }

  async function submitCohort(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await postDashboardMutation("/api/admin/cohorts", {
      name: cohortName
    });
    setCohortName("");
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="space-y-5">
        <div>
          <h2 className="text-3xl font-black text-white">Construtor de conteudo</h2>
          <p className="mt-2 text-sm text-zinc-500">
            Selecione um item do catalogo e monte trilhas, modulos, aulas e materiais dentro dele.
          </p>
        </div>

        <div className={`${panelClassName} overflow-hidden`}>
          <div className="border-b border-white/10 p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <StatusPill className="border-red-400/25 bg-red-500/10 text-red-200">
                  {selectedRecord?.kind ?? "Estrutura"}
                </StatusPill>
                <h3 className="mt-3 text-2xl font-black text-white">
                  {selectedRecord?.content.title ?? "Nenhum conteudo selecionado"}
                </h3>
                <p className="mt-2 text-sm font-semibold text-zinc-500">
                  {selectedRecord
                    ? `${getContentAccessModelLabel(selectedRecord.content.accessModel)} / ${getStudentLimitLabel(selectedRecord.content.maxStudents)}`
                    : "Escolha um item no Catalogo para comecar."}
                </p>
              </div>
              <button className="inline-flex min-h-10 items-center gap-2 rounded-[8px] bg-white px-4 py-2 text-sm font-black text-black transition hover:bg-zinc-200" type="button">
                <Plus className="h-4 w-4" />
                Persistido
              </button>
            </div>
          </div>

          <div className="divide-y divide-white/10">
            {!selectedRecord ? (
              <div className="p-8 text-center">
                <p className="text-lg font-black text-white">Nenhum item selecionado.</p>
                <p className="mt-2 text-sm text-zinc-500">Escolha ou crie um item no Catalogo para montar sua estrutura.</p>
              </div>
            ) : selectedOwnerModules.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-lg font-black text-white">Estrutura vazia.</p>
                <p className="mt-2 text-sm text-zinc-500">
                  Cadastre o primeiro modulo ou trilha para {selectedRecord.content.title}.
                </p>
              </div>
            ) : (
              <div className="p-5">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-[8px] bg-white/10 text-sm font-black text-white">
                    1
                  </span>
                  <div className="min-w-0 flex-1">
                    <h4 className="truncate text-base font-black text-white">{selectedRecord.content.title}</h4>
                    <p className="mt-1 text-sm text-zinc-500">
                      {selectedOwnerModules.length} modulo{selectedOwnerModules.length === 1 ? "" : "s"} configurado{selectedOwnerModules.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <StatusPill className={getContentAccessModelClassName(selectedRecord.content.accessModel)}>
                    {getContentAccessModelLabel(selectedRecord.content.accessModel)}
                  </StatusPill>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {selectedOwnerModules.map((module, moduleIndex) => (
                    <div className="rounded-[8px] border border-white/10 bg-black/25 p-4" key={module.id}>
                      <div className="flex items-start gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[8px] bg-white/[0.08] text-white">
                          <GalleryVerticalEnd className="h-5 w-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <h5 className="truncate text-sm font-black text-white">{module.title}</h5>
                            <button aria-label="Mais opcoes" className="text-zinc-500 hover:text-white" type="button">
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </div>
                          <p className="mt-1 text-xs font-semibold text-zinc-500">{module.lessons.length} aulas</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <StatusPill className={getAccessClassName(moduleIndex === 0 ? "Liberado" : "Drip")}>
                              {module.releaseRule ? getReleaseModeLabel(module.releaseRule.mode) : moduleIndex === 0 ? "Agora" : `${moduleIndex * 24}h`}
                            </StatusPill>
                            <StatusPill className="border-white/10 bg-white/[0.055] text-zinc-300">
                              {module.meta}
                            </StatusPill>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <aside className={`${panelClassName} h-fit p-5`}>
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-[8px] bg-[var(--accent)] text-white">
            <BookOpen className="h-5 w-5" />
          </span>
          <div>
            <h3 className="font-black text-white">Criacao rapida</h3>
            <p className="text-sm text-zinc-500">{selectedRecord?.content.title ?? "Base limpa"}</p>
          </div>
        </div>

        <div className="mt-6 space-y-6">
          <form className="space-y-3" onSubmit={submitModule}>
            <p className="text-sm font-black text-white">Novo modulo</p>
            <label className="grid gap-2 text-sm font-bold text-zinc-400">
              Nome do modulo
              <input
                className={inputClassName}
                onChange={(event) => setModuleTitle(event.target.value)}
                required
                value={moduleTitle}
              />
            </label>
            <label className="grid gap-2 text-sm font-bold text-zinc-400">
              URL da capa
              <input
                className={inputClassName}
                onChange={(event) => setModuleImage(event.target.value)}
                placeholder="Opcional"
                value={moduleImage}
              />
            </label>
            <label className="grid gap-2 text-sm font-bold text-zinc-400">
              Descricao
              <textarea
                className={`${inputClassName} min-h-20 resize-none py-3`}
                onChange={(event) => setModuleDescription(event.target.value)}
                value={moduleDescription}
              />
            </label>
            <label className="grid gap-2 text-sm font-bold text-zinc-400">
              Liberacao do modulo
              <select
                className={inputClassName}
                onChange={(event) => setModuleReleaseMode(event.target.value as AdminReleaseRule["mode"])}
                value={moduleReleaseMode}
              >
                <option value="immediate">Disponivel imediatamente</option>
                <option value="after_enrollment">X dias apos inscricao</option>
                <option value="fixed_date">Agendar publicacao</option>
                <option value="after_purchase">Depois do entitlement</option>
                <option value="after_previous_lesson">Depois do anterior</option>
                <option value="activity_required">Atividade obrigatoria</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-2 text-sm font-bold text-zinc-400">
                Tempo
                <input
                  className={inputClassName}
                  min="0"
                  onChange={(event) => setModuleReleaseDelayValue(event.target.value)}
                  placeholder="0"
                  type="number"
                  value={moduleReleaseDelayValue}
                />
              </label>
              <label className="grid gap-2 text-sm font-bold text-zinc-400">
                Unidade
                <select
                  className={inputClassName}
                  onChange={(event) => setModuleReleaseDelayUnit(event.target.value as "horas" | "dias")}
                  value={moduleReleaseDelayUnit}
                >
                  <option value="horas">horas</option>
                  <option value="dias">dias</option>
                </select>
              </label>
            </div>
            <label className="grid gap-2 text-sm font-bold text-zinc-400">
              Data agendada
              <input
                className={inputClassName}
                onChange={(event) => setModuleReleaseFixedDate(event.target.value)}
                type="datetime-local"
                value={moduleReleaseFixedDate}
              />
            </label>
            <button
              className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-[8px] bg-white px-4 py-2 text-sm font-black text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!selectedRecord}
              type="submit"
            >
              <Plus className="h-4 w-4" />
              Cadastrar modulo
            </button>
          </form>

          <form className="space-y-3 border-t border-white/10 pt-5" onSubmit={submitLesson}>
            <p className="text-sm font-black text-white">Nova aula</p>
            <label className="grid gap-2 text-sm font-bold text-zinc-400">
              Modulo
              <select
                className={inputClassName}
                disabled={selectedOwnerModules.length === 0}
                onChange={(event) => setLessonModuleId(event.target.value)}
                value={effectiveLessonModuleId}
              >
                {selectedOwnerModules.length === 0 ? (
                  <option value="">Cadastre um modulo primeiro</option>
                ) : null}
                {selectedOwnerModules.map((module) => (
                  <option key={module.id} value={module.id}>
                    {module.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-bold text-zinc-400">
              Titulo da aula
              <input
                className={inputClassName}
                onChange={(event) => setLessonTitle(event.target.value)}
                required
                value={lessonTitle}
              />
            </label>
            <label className="grid gap-2 text-sm font-bold text-zinc-400">
              Descricao da aula
              <textarea
                className={`${inputClassName} min-h-24 resize-none py-3`}
                onChange={(event) => setLessonDescription(event.target.value)}
                placeholder="Explique o que o aluno vai aprender nesta aula."
                value={lessonDescription}
              />
            </label>
            <label className="grid gap-2 text-sm font-bold text-zinc-400">
              Duracao
              <input
                className={inputClassName}
                onChange={(event) => setLessonDuration(event.target.value)}
                placeholder="Ex: 18 min ou 01:12:30"
                value={lessonDuration}
              />
            </label>
            <label className="grid gap-2 text-sm font-bold text-zinc-400">
              Thumbnail da aula
              <input
                className={inputClassName}
                onChange={(event) => setLessonImage(event.target.value)}
                placeholder="Opcional"
                value={lessonImage}
              />
            </label>
            <label className="grid gap-2 text-sm font-bold text-zinc-400">
              Player da aula
              <select
                className={inputClassName}
                onChange={(event) => setLessonVideoProvider(event.target.value as LessonVideoProvider)}
                value={lessonVideoProvider}
              >
                {lessonVideoProviderOptions.map(([provider, label]) => (
                  <option key={provider} value={provider}>{label}</option>
                ))}
              </select>
            </label>
            {lessonVideoProvider === "embed_code" ? (
              <label className="grid gap-2 text-sm font-bold text-zinc-400">
                Codigo embed
                <textarea
                  className={`${inputClassName} min-h-28 resize-none py-3 font-mono text-xs`}
                  onChange={(event) => setLessonVideoEmbedCode(event.target.value)}
                  placeholder="<iframe ...></iframe>"
                  value={lessonVideoEmbedCode}
                />
              </label>
            ) : (
              <>
                <label className="grid gap-2 text-sm font-bold text-zinc-400">
                  URL do video/player
                  <input
                    className={inputClassName}
                    onChange={(event) => setLessonVideoUrl(event.target.value)}
                    placeholder="https://..."
                    value={lessonVideoUrl}
                  />
                </label>
                <label className="grid gap-2 text-sm font-bold text-zinc-400">
                  ID do asset
                  <input
                    className={inputClassName}
                    onChange={(event) => setLessonVideoAssetId(event.target.value)}
                    placeholder="Opcional: id do YouTube, Vimeo, Bunny ou Mux"
                    value={lessonVideoAssetId}
                  />
                </label>
              </>
            )}
            <label className="grid gap-2 text-sm font-bold text-zinc-400">
              Liberacao da aula
              <select
                className={inputClassName}
                onChange={(event) => setLessonReleaseMode(event.target.value as AdminReleaseRule["mode"])}
                value={lessonReleaseMode}
              >
                <option value="immediate">Disponivel imediatamente</option>
                <option value="after_enrollment">X dias apos inscricao</option>
                <option value="fixed_date">Agendar publicacao</option>
                <option value="after_purchase">Depois do entitlement</option>
                <option value="after_previous_lesson">Depois da aula anterior</option>
                <option value="activity_required">Atividade obrigatoria</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-2 text-sm font-bold text-zinc-400">
                Tempo
                <input
                  className={inputClassName}
                  min="0"
                  onChange={(event) => setLessonReleaseDelayValue(event.target.value)}
                  placeholder="0"
                  type="number"
                  value={lessonReleaseDelayValue}
                />
              </label>
              <label className="grid gap-2 text-sm font-bold text-zinc-400">
                Unidade
                <select
                  className={inputClassName}
                  onChange={(event) => setLessonReleaseDelayUnit(event.target.value as "horas" | "dias")}
                  value={lessonReleaseDelayUnit}
                >
                  <option value="horas">horas</option>
                  <option value="dias">dias</option>
                </select>
              </label>
            </div>
            <label className="grid gap-2 text-sm font-bold text-zinc-400">
              Data agendada
              <input
                className={inputClassName}
                onChange={(event) => setLessonReleaseFixedDate(event.target.value)}
                type="datetime-local"
                value={lessonReleaseFixedDate}
              />
            </label>
            <button
              className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-[8px] bg-white px-4 py-2 text-sm font-black text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!effectiveLessonModuleId}
              type="submit"
            >
              <Play className="h-4 w-4" />
              Cadastrar aula
            </button>
          </form>

          <form className="space-y-3 border-t border-white/10 pt-5" onSubmit={submitCohort}>
            <p className="text-sm font-black text-white">Nova turma</p>
            <label className="grid gap-2 text-sm font-bold text-zinc-400">
              Nome da turma
              <input
                className={inputClassName}
                onChange={(event) => setCohortName(event.target.value)}
                required
                value={cohortName}
              />
            </label>
            <button className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-[8px] bg-white px-4 py-2 text-sm font-black text-black transition hover:bg-zinc-200" type="submit">
              <Users className="h-4 w-4" />
              Cadastrar turma
            </button>
            <div className="flex flex-wrap gap-2 pt-1">
              {cohorts.slice(0, 6).map((cohort) => (
                <StatusPill className="border-white/10 bg-white/[0.055] text-zinc-300" key={cohort}>
                  {cohort}
                </StatusPill>
              ))}
            </div>
          </form>
        </div>
      </aside>
    </div>
  );
}

type StudentModalMode = "view" | "new" | "edit" | null;
type StudentEngagementLevel = "Nenhum" | "Baixo" | "Medio" | "Alto" | "Altissimo";
type StudentAccessSetupMode = "invite" | "generated_password" | "manual_password" | "none";

type StudentAccessNotice = {
  copyText?: string;
  message: string;
  recipientEmail?: string;
  temporaryPassword?: string;
  title: string;
  tone: "success" | "warning" | "error" | "info";
};

type StudentFormState = {
  accessSetup: StudentAccessSetupMode;
  city: string;
  courseIds: string[];
  document: string;
  email: string;
  externalCustomerId: string;
  fullName: string;
  joinedAt: string;
  notes: string;
  phone: string;
  sourceProvider: AdminSourceProvider;
  state: string;
  status: AdminEntitlementStatus;
  tags: string;
  temporaryPassword: string;
};

const sourceProviderOptions = ["Hotmart", "Ticto", "TikTok", "Kiwify", "Manual"] satisfies AdminSourceProvider[];
const statusOptions = ["active", "suspended", "revoked", "expired"] satisfies AdminEntitlementStatus[];
const fallbackCohortOptions = ["Turma geral"];

const emptyStudentFormState: StudentFormState = {
  accessSetup: "invite",
  city: "",
  courseIds: [],
  document: "",
  email: "",
  externalCustomerId: "",
  fullName: "",
  joinedAt: "14/06/2026",
  notes: "",
  phone: "",
  sourceProvider: "Manual",
  state: "",
  status: "active",
  tags: "",
  temporaryPassword: ""
};

function getStudentInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function getStudentCategory(student: AdminStudent) {
  const categories = [...new Set(student.courses.map((course) => course.category).filter(Boolean))];

  if (categories.includes("VIP")) {
    return "VIP";
  }

  if (categories.includes("Cortesia")) {
    return "Cortesia";
  }

  if (categories.includes("Importado")) {
    return "Importado";
  }

  return categories[0] ?? (student.sourceProvider === "Manual" ? "Importado" : "Aluno");
}

function getCourseSourceLabel(course: AdminStudentCourse) {
  if (course.sourceProvider === "Manual") {
    return course.acquisition === "Cortesia" ? "Cortesia manual" : "Importado manual";
  }

  return `${course.sourceProvider} / ${course.acquisition ?? "Compra"}`;
}

function getCourseRoleLabel(course: AdminStudentCourse) {
  if (course.category === "Cortesia" && (course.role ?? "Estudante") === "Estudante") {
    return "Estudante convidado";
  }

  return course.role ?? "Estudante";
}

function getStudentAverageProgress(student: AdminStudent) {
  if (student.courses.length === 0) {
    return 0;
  }

  return Math.round(
    student.courses.reduce((total, course) => total + course.progressPercent, 0) / student.courses.length
  );
}

function getStudentEngagement(student: AdminStudent): StudentEngagementLevel {
  const accessCount = student.accessCount ?? 0;
  const averageProgress = getStudentAverageProgress(student);

  if (accessCount === 0 && averageProgress === 0) {
    return "Nenhum";
  }

  if (accessCount >= 45 || averageProgress >= 85) {
    return "Altissimo";
  }

  if (accessCount >= 20 || averageProgress >= 50) {
    return "Alto";
  }

  if (accessCount >= 6 || averageProgress >= 20) {
    return "Medio";
  }

  return "Baixo";
}

function getStudentCourseProduct(course: AdminStudentCourse, sellableProducts: AdminSellableProduct[]) {
  return sellableProducts.find((product) => product.id === course.targetId);
}

function getNextCohort(currentCohort: string | undefined, cohorts: string[]) {
  const cohortOptions = cohorts.length > 0 ? cohorts : fallbackCohortOptions;
  const currentIndex = cohortOptions.findIndex((cohort) => cohort === currentCohort);

  if (currentIndex < 0) {
    return cohortOptions[0];
  }

  return cohortOptions[(currentIndex + 1) % cohortOptions.length];
}

function toStudentFormState(student: AdminStudent): StudentFormState {
  return {
    accessSetup: "none",
    city: student.city,
    courseIds: student.courses.map((course) => course.targetId),
    document: student.document,
    email: student.email,
    externalCustomerId: student.externalCustomerId,
    fullName: student.fullName,
    joinedAt: student.joinedAt,
    notes: student.notes,
    phone: student.phone,
    sourceProvider: student.sourceProvider,
    state: student.state,
    status: student.status,
    tags: student.tags.join(", "),
    temporaryPassword: ""
  };
}

function buildStudentCourses({
  courseIds,
  existingCourses,
  joinedAt,
  sellableProducts,
  sourceProvider,
  status
}: {
  courseIds: string[];
  existingCourses?: AdminStudentCourse[];
  joinedAt: string;
  sellableProducts: AdminSellableProduct[];
  sourceProvider: AdminSourceProvider;
  status: AdminEntitlementStatus;
}) {
  return courseIds.flatMap((courseId, index) => {
    const product = sellableProducts.find((item) => item.id === courseId);

    if (!product) {
      return [];
    }

    const existingCourse = existingCourses?.find((course) => course.targetId === courseId);

    return [
      {
        acquisition: existingCourse?.acquisition ?? (sourceProvider === "Manual" ? "Manual" : "Compra"),
        category: existingCourse?.category ?? (sourceProvider === "Manual" ? "Importado" : "Aluno"),
        cohort: existingCourse?.cohort ?? "Turma geral",
        endsAt: existingCourse?.endsAt ?? "Vitalicio",
        externalOrderId:
          existingCourse?.externalOrderId ?? `${sourceProvider.toLowerCase()}-manual-${Date.now()}-${index + 1}`,
        id: existingCourse?.id ?? `student-course-${Date.now()}-${index + 1}`,
        lastActivityAt: existingCourse?.lastActivityAt ?? "Nunca acessou",
        product: product.title,
        progressPercent: existingCourse?.progressPercent ?? 0,
        role: existingCourse?.role ?? "Estudante",
        sourceProvider: existingCourse?.sourceProvider ?? sourceProvider,
        startsAt: existingCourse?.startsAt ?? joinedAt,
        status: existingCourse?.status ?? status,
        targetId: product.id,
        targetType: product.targetType
      }
    ];
  });
}

function formatAdminAccessDate(value: string) {
  const normalizedValue = value.trim().toLowerCase();

  if (!value || normalizedValue.includes("sem acesso") || normalizedValue.includes("nunca")) {
    return value || "Sem acesso";
  }

  return `${value} (UTC-3 Brasil)`;
}

function StudentAvatar({
  avatarUrl,
  name,
  size = "sm"
}: {
  avatarUrl?: string;
  name: string;
  size?: "sm" | "lg";
}) {
  const sizeClassName = size === "lg" ? "h-14 w-14 text-base" : "h-9 w-9 text-xs";

  return (
    <span
      className={`grid shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--accent)] bg-cover bg-center font-semibold text-white ring-1 ring-red-400/25 ${sizeClassName}`}
      style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}
    >
      {getStudentInitials(name)}
    </span>
  );
}

function ProductCover({
  course,
  sellableProducts,
  size = "sm"
}: {
  course: AdminStudentCourse;
  sellableProducts: AdminSellableProduct[];
  size?: "xs" | "sm" | "md";
}) {
  const product = getStudentCourseProduct(course, sellableProducts);
  const sizeClassName = size === "md" ? "h-24 w-16" : size === "xs" ? "h-7 w-5" : "h-14 w-10";

  return (
    <span className={`relative block shrink-0 overflow-hidden rounded-[6px] bg-[#101010] ring-1 ring-white/10 ${sizeClassName}`}>
      {product?.image ? (
        <span
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${product.image})` }}
        />
      ) : (
        <span className="absolute inset-0 grid place-items-center bg-[#202020] text-zinc-500">
          <BookOpen className={size === "md" ? "h-5 w-5" : "h-4 w-4"} />
        </span>
      )}
    </span>
  );
}

function StudentRowActions({
  accessActionBusy,
  onBlockAllCourses,
  onEdit,
  onMoveAllCourses,
  onOpenDetails,
  onRemove,
  onResendEmail,
  student
}: {
  accessActionBusy: boolean;
  onBlockAllCourses: () => void;
  onEdit: () => void;
  onMoveAllCourses: () => void;
  onOpenDetails: () => void;
  onRemove: () => void;
  onResendEmail: () => void;
  student: AdminStudent;
}) {
  const hasCourses = student.courses.length > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Acoes de ${student.fullName}`}
        className="grid h-8 w-8 place-items-center rounded-full text-zinc-500 outline-none transition hover:bg-white/10 hover:text-white focus-visible:ring-3 focus-visible:ring-white/10"
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-60 rounded-[8px] border border-white/10 bg-[#17181d] p-2 text-zinc-200 shadow-[0_24px_70px_rgba(0,0,0,0.55)]"
      >
        <DropdownMenuItem className="rounded-[7px] px-2.5 py-2.5 text-sm font-semibold text-zinc-200 focus:bg-white/10 focus:text-white" onClick={onOpenDetails}>
          <Eye className="h-4 w-4" />
          Detalhes do usuario
        </DropdownMenuItem>
        <DropdownMenuItem
          className="rounded-[7px] px-2.5 py-2.5 text-sm font-semibold text-zinc-200 focus:bg-white/10 focus:text-white"
          disabled={accessActionBusy}
          onClick={onResendEmail}
        >
          <Mail className="h-4 w-4" />
          Reenviar acesso
        </DropdownMenuItem>
        <DropdownMenuItem
          className="rounded-[7px] px-2.5 py-2.5 text-sm font-semibold text-zinc-200 focus:bg-white/10 focus:text-white"
          disabled={!hasCourses}
          onClick={onBlockAllCourses}
        >
          <Ban className="h-4 w-4" />
          Bloquear acesso a produtos
        </DropdownMenuItem>
        <DropdownMenuItem
          className="rounded-[7px] px-2.5 py-2.5 text-sm font-semibold text-zinc-200 focus:bg-white/10 focus:text-white"
          disabled={!hasCourses}
          onClick={onMoveAllCourses}
        >
          <ArrowRightLeft className="h-4 w-4" />
          Mudar turma
        </DropdownMenuItem>
        <DropdownMenuSeparator className="-mx-2 bg-white/10" />
        <DropdownMenuItem className="rounded-[7px] px-2.5 py-2.5 text-sm font-semibold text-zinc-200 focus:bg-white/10 focus:text-white" onClick={onEdit}>
          <Pencil className="h-4 w-4" />
          Editar cadastro
        </DropdownMenuItem>
        <DropdownMenuItem
          className="rounded-[7px] px-2.5 py-2.5 text-sm font-semibold text-red-200 focus:bg-red-500/15 focus:text-red-100"
          onClick={onRemove}
          variant="destructive"
        >
          <Trash2 className="h-4 w-4" />
          Remover aluno
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StudentInfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid min-h-14 grid-cols-[minmax(8rem,0.55fr)_minmax(0,1fr)] items-center gap-4 border-b border-white/10 py-3 last:border-b-0">
      <dt className="text-sm font-medium text-zinc-500">{label}</dt>
      <dd className="min-w-0 break-words text-right text-sm font-semibold leading-5 text-zinc-100">{value}</dd>
    </div>
  );
}

function StudentDetailMetricPanel({
  children,
  icon: Icon,
  label,
  value
}: {
  children?: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <section className="min-h-32 rounded-[8px] border border-white/10 bg-[linear-gradient(145deg,#1b1d23_0%,#14151a_52%,#101116_100%)] px-5 py-4 shadow-[0_18px_50px_rgba(0,0,0,0.22)] ring-1 ring-white/[0.025]">
      <div className="flex items-center gap-2 text-xs font-semibold text-zinc-500">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-8 flex items-end justify-between gap-6">
        <div className="min-w-0 text-3xl font-semibold tracking-normal text-white">{value}</div>
        {children}
      </div>
    </section>
  );
}

function StudentAccessNoticePanel({
  notice,
  onDismiss
}: {
  notice: StudentAccessNotice;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const toneClassName = notice.tone === "error"
    ? "border-red-400/25 bg-red-500/10 text-red-100"
    : notice.tone === "warning"
      ? "border-amber-400/25 bg-amber-500/10 text-amber-100"
      : notice.tone === "info"
        ? "border-sky-400/25 bg-sky-500/10 text-sky-100"
      : "border-emerald-400/25 bg-emerald-500/10 text-emerald-100";

  async function copyAccessText() {
    if (!notice.copyText) {
      return;
    }

    await navigator.clipboard.writeText(notice.copyText);
    setCopied(true);
  }

  return (
    <div className={`rounded-[8px] border p-4 shadow-[0_18px_50px_rgba(0,0,0,0.22)] ${toneClassName}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-current">{notice.title}</p>
          <p className="mt-1 text-sm font-semibold text-current/80">{notice.message}</p>
          {notice.temporaryPassword ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
              <code className="min-h-10 overflow-x-auto rounded-[7px] border border-current/15 bg-black/25 px-3 py-2 text-sm font-semibold text-current">
                {notice.temporaryPassword}
              </code>
              <button
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[7px] border border-current/15 bg-black/25 px-3 py-2 text-sm font-semibold text-current transition hover:bg-white/10"
                onClick={copyAccessText}
                type="button"
              >
                <Copy className="h-4 w-4" />
                {copied ? "Copiado" : "Copiar"}
              </button>
            </div>
          ) : null}
        </div>
        <button
          aria-label="Fechar aviso"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-current transition hover:bg-white/10"
          onClick={onDismiss}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function StudentProductAccessTable({
  courses,
  sellableProducts
}: {
  courses: AdminStudentCourse[];
  sellableProducts: AdminSellableProduct[];
}) {
  if (courses.length === 0) {
    return (
      <div className="rounded-[8px] border border-dashed border-white/10 bg-[#15161b] p-8 text-center">
        <p className="text-sm font-semibold text-zinc-500">Este aluno ainda nao possui produtos vinculados.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[8px] border border-white/10 bg-[#15161b]">
      <div className="overflow-x-auto">
      <Table className="min-w-[920px]">
        <TableHeader>
          <TableRow className="border-b border-white/10 bg-white/[0.025] hover:bg-white/[0.025]">
            <TableHead className="w-[32%] px-4 py-3 text-xs font-semibold text-zinc-500">Produto</TableHead>
            <TableHead className="py-3 text-xs font-semibold text-zinc-500">Progresso</TableHead>
            <TableHead className="py-3 text-xs font-semibold text-zinc-500">Turma</TableHead>
            <TableHead className="py-3 text-xs font-semibold text-zinc-500">Papel</TableHead>
            <TableHead className="py-3 text-xs font-semibold text-zinc-500">Categoria</TableHead>
            <TableHead className="py-3 pr-4 text-xs font-semibold text-zinc-500">Acesso</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {courses.map((course) => {
            const product = getStudentCourseProduct(course, sellableProducts);
            const courseProgress = Math.min(100, Math.max(0, course.progressPercent));

            return (
              <TableRow className="border-b border-white/10 hover:bg-white/[0.035]" key={course.id}>
                <TableCell className="px-4 py-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <ProductCover course={course} sellableProducts={sellableProducts} size="xs" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{course.product}</p>
                      <p className="mt-0.5 truncate text-xs text-zinc-500">
                        {product?.kind ?? "Produto"}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex min-w-[8rem] items-center gap-3 text-sm font-semibold text-zinc-200">
                    <span>{courseProgress}%</span>
                    <div className="h-1 w-24 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${courseProgress}%` }} />
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-sm font-semibold text-zinc-300">{course.cohort ?? "Sem turma"}</TableCell>
                <TableCell className="text-sm font-semibold text-zinc-300">{getCourseRoleLabel(course)}</TableCell>
                <TableCell className="text-sm font-semibold text-zinc-300">{course.category ?? getCourseSourceLabel(course)}</TableCell>
                <TableCell className="pr-4">
                  <StatusPill className={getSoftEntitlementStatusClassName(course.status)}>
                    {getEntitlementStatusLabel(course.status)}
                  </StatusPill>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      </div>
    </div>
  );
}

function StudentDeleteConfirmationModal({
  onCancel,
  onConfirm,
  student
}: {
  onCancel: () => void;
  onConfirm: () => void;
  student: AdminStudent | null;
}) {
  useEffect(() => {
    if (!student) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = "hidden";

    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, [student]);

  if (!student) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/78 px-4 py-6 backdrop-blur-md">
      <section
        aria-labelledby="delete-student-title"
        aria-modal="true"
        className="w-full max-w-lg overflow-hidden rounded-[12px] border border-red-400/25 bg-[#0d0e11] shadow-[0_36px_140px_rgba(0,0,0,0.78)] ring-1 ring-white/[0.035]"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 bg-gradient-to-r from-[#1f1718] via-[#141216] to-[#0d0e11] p-5">
          <div className="flex min-w-0 gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[8px] border border-red-400/25 bg-red-500/12 text-red-200 shadow-inner shadow-red-500/10">
              <Trash2 className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-normal text-red-200/70">Confirmacao necessaria</p>
              <h3 className="mt-1 text-xl font-semibold tracking-normal text-white" id="delete-student-title">
                Excluir aluno?
              </h3>
            </div>
          </div>
          <button
            aria-label="Cancelar exclusao"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[7px] border border-white/10 bg-white/[0.06] text-zinc-300 transition hover:bg-white/10 hover:text-white"
            onClick={onCancel}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="flex items-center gap-4 rounded-[10px] border border-white/12 bg-gradient-to-br from-[#18191f] via-[#121318] to-[#0d0e11] p-4 shadow-[0_14px_44px_rgba(0,0,0,0.34)] ring-1 ring-white/[0.025]">
            <StudentAvatar avatarUrl={student.avatarUrl} name={student.fullName} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{student.fullName}</p>
              <p className="mt-1 truncate text-sm font-medium text-zinc-500">{student.email}</p>
              <div className="mt-2">
                <StatusPill className={getEntitlementStatusClassName(student.status)}>
                  {getEntitlementStatusLabel(student.status)}
                </StatusPill>
              </div>
            </div>
          </div>

          <p className="text-sm font-medium leading-6 text-zinc-400">
            Esta acao remove o cadastro da listagem administrativa. Historico bruto de webhook, eventos de auditoria
            e registros externos nao sao apagados por esta operacao.
          </p>

          <div className="flex flex-col-reverse gap-3 border-t border-white/10 pt-4 sm:flex-row sm:justify-end">
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-[8px] border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
              onClick={onCancel}
              type="button"
            >
              Cancelar
            </button>
            <button
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] border border-red-400/25 bg-red-500/15 px-4 py-2 text-sm font-semibold text-red-100 transition hover:bg-red-500/25"
              onClick={onConfirm}
              type="button"
            >
              <Trash2 className="h-4 w-4" />
              Excluir aluno
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function StudentFormSection({
  children,
  description,
  icon: Icon,
  title
}: {
  children: React.ReactNode;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
}) {
  return (
    <section className="border-b border-white/10 px-5 py-6 last:border-b-0 sm:px-6">
      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="flex min-w-0 gap-3">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-[8px] border border-white/10 bg-white/[0.045] text-zinc-400">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-white">{title}</h4>
            <p className="mt-1 text-sm leading-5 text-zinc-500">{description}</p>
          </div>
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  );
}

function StudentProductPickerCard({
  onToggle,
  product,
  selected
}: {
  onToggle: () => void;
  product: AdminSellableProduct;
  selected: boolean;
}) {
  return (
    <button
      className={`flex min-w-0 items-center gap-3 px-3 py-3 text-left transition ${
        selected
          ? "bg-red-500/10 shadow-[inset_3px_0_0_var(--accent)]"
          : "hover:bg-white/[0.045]"
      }`}
      onClick={onToggle}
      type="button"
    >
      <span className="relative h-12 w-9 shrink-0 overflow-hidden rounded-[6px] bg-[#101010] ring-1 ring-white/10">
        <span
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${product.image})` }}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-white">{product.title}</span>
        <span className="mt-0.5 block truncate text-xs text-zinc-500">{product.kind}</span>
      </span>
      <span
        className={`grid size-5 shrink-0 place-items-center rounded-md border ${
          selected ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-white/15 text-transparent"
        }`}
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}

function StudentFormFields({
  formState,
  onChange,
  showAccessSetup,
  onToggleCourse,
  sellableProducts
}: {
  formState: StudentFormState;
  onChange: (field: keyof StudentFormState, value: string) => void;
  showAccessSetup: boolean;
  onToggleCourse: (courseId: string) => void;
  sellableProducts: AdminSellableProduct[];
}) {
  return (
    <div className="overflow-hidden rounded-[8px] border border-white/10 bg-[#17181d]">
      <StudentFormSection
        description="Dados principais usados para busca, contato e identificacao."
        icon={Users}
        title="Identidade do aluno"
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <label className="grid gap-2 text-sm font-semibold text-zinc-200">
            Nome
            <input
              className={studentFormInputClassName}
              onChange={(event) => onChange("fullName", event.target.value)}
              required
              value={formState.fullName}
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-zinc-200">
            Email
            <input
              className={studentFormInputClassName}
              onChange={(event) => onChange("email", event.target.value)}
              required
              type="email"
              value={formState.email}
            />
          </label>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-4">
          <label className="grid gap-2 text-sm font-semibold text-zinc-200 lg:col-span-2">
            Telefone
            <input className={studentFormInputClassName} onChange={(event) => onChange("phone", event.target.value)} value={formState.phone} />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-zinc-200 lg:col-span-2">
            Documento
            <input
              className={studentFormInputClassName}
              onChange={(event) => onChange("document", event.target.value)}
              value={formState.document}
            />
          </label>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-4">
          <label className="grid gap-2 text-sm font-semibold text-zinc-200 lg:col-span-2">
            Cidade
            <input className={studentFormInputClassName} onChange={(event) => onChange("city", event.target.value)} value={formState.city} />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-zinc-200">
            UF
            <input className={studentFormInputClassName} maxLength={2} onChange={(event) => onChange("state", event.target.value)} value={formState.state} />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-zinc-200">
            Entrada
            <input
              className={studentFormInputClassName}
              onChange={(event) => onChange("joinedAt", event.target.value)}
              value={formState.joinedAt}
            />
          </label>
        </div>
      </StudentFormSection>

      {showAccessSetup ? (
        <StudentFormSection
          description="Configure como o aluno vai receber o primeiro acesso."
          icon={KeyRound}
          title="Primeiro acesso"
        >
          <div className="grid gap-3 lg:grid-cols-[1fr_1.1fr]">
            <div className="border-l border-white/10 pl-4">
              <p className="text-sm font-semibold text-white">
                Convite seguro
              </p>
              <p className="mt-2 text-sm leading-6 text-zinc-500">
                Convite por email e o padrao. Senha temporaria exige troca no primeiro login.
              </p>
            </div>

            <div className="grid gap-3">
              <label className="grid gap-2 text-sm font-semibold text-zinc-200">
                Entrega
                <select
                  className={studentFormInputClassName}
                  onChange={(event) => onChange("accessSetup", event.target.value)}
                  value={formState.accessSetup}
                >
                  <option value="invite">Enviar convite para criar senha</option>
                  <option value="generated_password">Gerar senha temporaria automaticamente</option>
                  <option value="manual_password">Criar senha temporaria manualmente</option>
                  <option value="none">Nao enviar agora</option>
                </select>
              </label>

              {formState.accessSetup === "manual_password" ? (
                <label className="grid gap-2 text-sm font-semibold text-zinc-200">
                  Senha temporaria
                  <input
                    autoComplete="new-password"
                    className={studentFormInputClassName}
                    minLength={8}
                    onChange={(event) => onChange("temporaryPassword", event.target.value)}
                    placeholder="Minimo de 8 caracteres"
                    required
                    type="password"
                    value={formState.temporaryPassword}
                  />
                </label>
              ) : null}
            </div>
          </div>

        </StudentFormSection>
      ) : null}

      <StudentFormSection
        description="Fonte da compra/importacao, status geral e identificador externo."
        icon={CalendarDays}
        title="Origem e status"
      >
        <div className="grid gap-3 lg:grid-cols-3">
          <label className="grid gap-2 text-sm font-semibold text-zinc-200">
            Origem
            <select
              className={studentFormInputClassName}
              onChange={(event) => onChange("sourceProvider", event.target.value)}
              value={formState.sourceProvider}
            >
              {sourceProviderOptions.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-semibold text-zinc-200">
            Status
            <select
              className={studentFormInputClassName}
              onChange={(event) => onChange("status", event.target.value)}
              value={formState.status}
            >
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {getEntitlementStatusLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-semibold text-zinc-200">
            ID externo
            <input
              className={studentFormInputClassName}
              onChange={(event) => onChange("externalCustomerId", event.target.value)}
              value={formState.externalCustomerId}
            />
          </label>
        </div>
      </StudentFormSection>

      <StudentFormSection
        description="Produtos liberados para este aluno dentro da area de alunos."
        icon={LibraryBig}
        title="Produtos comprados"
      >
        <div className="overflow-hidden rounded-[8px] border border-white/10 divide-y divide-white/10">
          {sellableProducts.map((product) => (
            <StudentProductPickerCard
              key={product.id}
              onToggle={() => onToggleCourse(product.id)}
              product={product}
              selected={formState.courseIds.includes(product.id)}
            />
          ))}
        </div>
      </StudentFormSection>

      <StudentFormSection
        description="Contexto interno para suporte, segmentacao e operacao."
        icon={Pencil}
        title="Notas internas"
      >
        <div className="grid gap-3">
          <label className="grid gap-2 text-sm font-semibold text-zinc-200">
            Tags
            <input
              className={studentFormInputClassName}
              onChange={(event) => onChange("tags", event.target.value)}
              placeholder="novo aluno, bootcamp"
              value={formState.tags}
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-zinc-200">
            Observacoes
            <textarea
              className={`${studentFormInputClassName} min-h-28 resize-none py-3`}
              onChange={(event) => onChange("notes", event.target.value)}
              value={formState.notes}
            />
          </label>
        </div>
      </StudentFormSection>
    </div>
  );
}

function StudentProfileModal({
  accessActionBusy,
  formSubmitting,
  formState,
  modalMode,
  onChange,
  onClose,
  onEdit,
  onRemove,
  onResendAccess,
  onSubmit,
  onToggleCourse,
  sellableProducts,
  student
}: {
  accessActionBusy: boolean;
  formSubmitting: boolean;
  formState: StudentFormState;
  modalMode: StudentModalMode;
  onChange: (field: keyof StudentFormState, value: string) => void;
  onClose: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onResendAccess: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onToggleCourse: (courseId: string) => void;
  sellableProducts: AdminSellableProduct[];
  student: AdminStudent | null;
}) {
  if (!modalMode) {
    return null;
  }

  const isFormMode = modalMode === "new" || modalMode === "edit";
  const title = modalMode === "new" ? "Novo aluno" : modalMode === "edit" ? "Editar aluno" : "Perfil do aluno";
  const firstAccess = formatAdminAccessDate(student?.firstAccessAt ?? student?.joinedAt ?? "Sem acesso");
  const lastAccess = formatAdminAccessDate(student?.lastActivityAt ?? "Sem acesso");
  const accessCount = student?.accessCount ?? 0;
  const studentCategory = student ? getStudentCategory(student) : "Aluno";
  const studentEngagement = student ? getStudentEngagement(student) : "Nenhum";
  const studentAverageProgress = student ? getStudentAverageProgress(student) : 0;
  const selectedCourseCount = formState.courseIds.length;
  const modalSubject = student && modalMode !== "new" ? student.fullName : "Novo aluno";

  return (
    <Dialog
      open={Boolean(modalMode)}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent
        className="max-w-[min(1240px,calc(100vw-2rem))] rounded-[12px] border border-white/10 bg-[#0d0e11] p-0 text-zinc-100 shadow-[0_34px_140px_rgba(0,0,0,0.78)] ring-1 ring-white/[0.035]"
        showCloseButton={false}
      >
        <DialogHeader className="shrink-0 border-b border-white/10 bg-[linear-gradient(135deg,#1c1114_0%,#17181d_42%,#101116_100%)] p-0">
          <div className="flex items-center justify-between gap-4 px-5 py-4 sm:px-7">
            <div className="min-w-0">
              <DialogDescription className="text-sm font-semibold text-zinc-500">
                <span className="text-zinc-200 underline underline-offset-2">Alunos</span>
                <span className="px-3 text-zinc-700">/</span>
                <span>{modalSubject}</span>
              </DialogDescription>
              <DialogTitle className="sr-only" id="student-profile-modal-title">
                {title} - {modalSubject}
              </DialogTitle>
            </div>
            <Button
              aria-label="Fechar modal do aluno"
              className="size-9 rounded-full text-zinc-500 hover:bg-white/10 hover:text-white"
              onClick={onClose}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </DialogHeader>

        {isFormMode ? (
          <form className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#0d0e11]" onSubmit={onSubmit}>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <section className="border-b border-white/10 bg-[#101116] px-5 py-6 sm:px-8">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-500">
                      {modalMode === "new" ? "Novo cadastro" : "Atualizacao cadastral"}
                    </p>
                    <h2 className="mt-2 truncate text-3xl font-semibold tracking-normal text-white">
                      {student && modalMode === "edit" ? student.fullName : "Configurar aluno"}
                    </h2>
                  </div>
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    {[
                      ["Origem", formState.sourceProvider],
                      ["Produtos", `${selectedCourseCount} selecionado${selectedCourseCount === 1 ? "" : "s"}`],
                      ["Status", getEntitlementStatusLabel(formState.status)]
                    ].map(([label, value]) => (
                      <span className="inline-flex min-h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-3 text-xs font-semibold text-zinc-300" key={label}>
                        <span className="text-zinc-500">{label}</span>
                        <span className="text-white">{value}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </section>

              <div className="px-5 py-6 sm:px-8">
                <StudentFormFields
                  formState={formState}
                  onChange={onChange}
                  showAccessSetup={modalMode === "new"}
                  onToggleCourse={onToggleCourse}
                  sellableProducts={sellableProducts}
                />
              </div>
            </div>

            <div className="sticky bottom-0 z-20 flex flex-col-reverse gap-3 border-t border-white/10 bg-[#17181d]/96 px-5 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-8">
              <p className="text-xs font-semibold text-zinc-500">
                Entitlements internos continuam sendo a fonte de verdade para liberar acesso.
              </p>
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
                <Button
                  className="h-10 rounded-[8px] border-white/10 bg-[#111217] px-4 text-zinc-200 hover:bg-white/10 hover:text-white"
                  onClick={onClose}
                  type="button"
                  variant="outline"
                >
                  Cancelar
                </Button>
                <Button
                  className="h-10 rounded-[8px] bg-[var(--accent)] px-4 text-white hover:bg-[#ff1f2a]"
                  disabled={formSubmitting}
                  type="submit"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {formSubmitting ? "Salvando..." : modalMode === "new" ? "Adicionar aluno" : "Salvar alteracoes"}
                </Button>
              </div>
            </div>
          </form>
        ) : student ? (
          <div className="min-h-0 flex-1 overflow-y-auto bg-[#0d0e11]">
            <div className="px-5 py-7 sm:px-8">
              <section className="rounded-[10px] border border-white/10 bg-[linear-gradient(145deg,#211216_0%,#17181d_44%,#101116_100%)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.38)] ring-1 ring-white/[0.025]">
                <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex min-w-0 items-center gap-4">
                    <StudentAvatar avatarUrl={student.avatarUrl} name={student.fullName} size="lg" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-normal text-red-200/70">Perfil do aluno</p>
                      <h2 className="mt-1 truncate text-3xl font-semibold tracking-normal text-white">{student.fullName}</h2>
                      <p className="mt-1 truncate text-sm font-medium text-zinc-500">{student.email}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <StatusPill className={getSoftEntitlementStatusClassName(student.status)}>
                          {getEntitlementStatusLabel(student.status)}
                        </StatusPill>
                        <StatusPill className="border-white/10 bg-white/[0.055] text-zinc-300">
                          {studentCategory}
                        </StatusPill>
                        <StatusPill className={getProviderClassName(student.sourceProvider)}>
                          {student.sourceProvider}
                        </StatusPill>
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button
                      className="h-10 rounded-[8px] border-white/10 bg-[#17181d] px-4 text-zinc-200 hover:bg-white/10 hover:text-white"
                      disabled={accessActionBusy}
                      onClick={onResendAccess}
                      type="button"
                      variant="outline"
                    >
                      <Send className="h-4 w-4" />
                      Reenviar acesso
                    </Button>
                    <Button
                      className="h-10 rounded-[8px] bg-[var(--accent)] px-4 text-white hover:bg-[#ff1f2a]"
                      onClick={onEdit}
                      type="button"
                    >
                      <Pencil className="h-4 w-4" />
                      Editar cadastro
                    </Button>
                    <Button
                      className="h-10 rounded-[8px] bg-red-500/10 px-4 text-red-200 hover:bg-red-500/20"
                      onClick={onRemove}
                      type="button"
                      variant="destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                      Remover
                    </Button>
                  </div>
                </div>
              </section>

              <div className="mt-5 grid gap-5 xl:grid-cols-[18rem_minmax(0,1fr)]">
                <aside className="space-y-4">
                  <section className="rounded-[8px] border border-white/10 bg-[#15161b] p-4">
                    <h3 className="text-sm font-semibold text-white">Resumo de acesso</h3>
                    <dl className="mt-4 space-y-3">
                      {[
                        ["Produtos", student.courses.length.toString()],
                        ["Acessos", accessCount.toString()],
                        ["Primeiro acesso", firstAccess],
                        ["Ultimo acesso", lastAccess]
                      ].map(([label, value]) => (
                        <div className="border-b border-white/10 pb-3 last:border-b-0 last:pb-0" key={label}>
                          <dt className="text-xs font-semibold text-zinc-500">{label}</dt>
                          <dd className="mt-1 break-words text-sm font-semibold text-zinc-100">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>

                  <section className="rounded-[8px] border border-white/10 bg-[#15161b] p-4">
                    <h3 className="text-sm font-semibold text-white">Segmentacao</h3>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {(student.tags.length > 0 ? student.tags : ["sem tags"]).map((tag) => (
                        <span className="rounded-full border border-white/10 bg-white/[0.045] px-2.5 py-1 text-xs font-semibold text-zinc-300" key={tag}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  </section>
                </aside>

                <div className="min-w-0 space-y-5">
                  <section className="grid gap-4 lg:grid-cols-2">
                    <StudentDetailMetricPanel
                      icon={TrendingUp}
                      label="Progresso medio"
                      value={`${studentAverageProgress}%`}
                    >
                      <div className="h-1 w-64 max-w-[45vw] overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-[var(--accent)]"
                          style={{ width: `${Math.min(100, Math.max(0, studentAverageProgress))}%` }}
                        />
                      </div>
                    </StudentDetailMetricPanel>
                    <StudentDetailMetricPanel
                      icon={Activity}
                      label="Engajamento"
                      value={studentEngagement}
                    >
                      <div className="flex h-8 items-end gap-1">
                        {[22, 36, 52, 68].map((height, index) => (
                          <span
                            className={`w-1 rounded-full ${index < Math.max(1, Math.ceil(accessCount / 8)) ? "bg-[var(--accent)]" : "bg-white/15"}`}
                            key={height}
                            style={{ height }}
                          />
                        ))}
                      </div>
                    </StudentDetailMetricPanel>
                  </section>

                  <section className="rounded-[8px] border border-white/10 bg-[#15161b] p-5">
                    <h3 className="text-xl font-semibold tracking-normal text-white">Informacoes e dados pessoais</h3>
                    <div className="mt-5 grid gap-x-8 lg:grid-cols-2">
                      <dl>
                        <StudentInfoRow label="Nome completo" value={student.fullName} />
                        <StudentInfoRow label="E-mail" value={student.email} />
                        <StudentInfoRow label="Categoria" value={studentCategory} />
                        <StudentInfoRow label="Telefone" value={student.phone || "Nao informado"} />
                        <StudentInfoRow label="Documento" value={student.document || "Nao informado"} />
                      </dl>
                      <dl>
                        <StudentInfoRow label="Primeiro acesso" value={firstAccess} />
                        <StudentInfoRow label="Ultimo acesso" value={lastAccess} />
                        <StudentInfoRow label="Quantidade de acessos" value={accessCount} />
                        <StudentInfoRow label="Acesso geral" value={getEntitlementStatusLabel(student.status)} />
                        <StudentInfoRow label="Cidade/UF" value={`${student.city || "Nao informada"}/${student.state || "--"}`} />
                      </dl>
                    </div>
                  </section>

                  <section>
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <h3 className="text-xl font-semibold tracking-normal text-white">Produtos</h3>
                      <span className="text-sm font-semibold text-zinc-500">
                        {student.courses.length} produto{student.courses.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <StudentProductAccessTable
                      courses={student.courses}
                      sellableProducts={sellableProducts}
                    />
                  </section>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

type StudentListUpdater = AdminStudent[] | ((students: AdminStudent[]) => AdminStudent[]);
type PersistStudents = (updater: StudentListUpdater) => Promise<AdminStudent[]>;

function StudentsView({
  cohorts,
  onChangeStudents,
  onSelectStudent,
  selectedStudentId,
  sellableProducts,
  students
}: {
  cohorts: string[];
  onChangeStudents: PersistStudents;
  onSelectStudent: (studentId: string) => void;
  selectedStudentId: string;
  sellableProducts: AdminSellableProduct[];
  students: AdminStudent[];
}) {
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | AdminSourceProvider>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | AdminEntitlementStatus>("all");
  const [courseFilter, setCourseFilter] = useState<"all" | string>("all");
  const [modalMode, setModalMode] = useState<StudentModalMode>(null);
  const [accessActionBusy, setAccessActionBusy] = useState(false);
  const [accessNotice, setAccessNotice] = useState<StudentAccessNotice | null>(null);
  const [formState, setFormState] = useState<StudentFormState>(emptyStudentFormState);
  const [studentPendingDeletion, setStudentPendingDeletion] = useState<AdminStudent | null>(null);
  const [studentFormSubmitting, setStudentFormSubmitting] = useState(false);

  const normalizedQuery = normalizeSearchValue(query.trim());
  const selectedStudent = students.find((student) => student.id === selectedStudentId) ?? students[0] ?? null;

  const filteredStudents = useMemo(() => (
    students.filter((student) => {
      const searchableValues = [
        student.fullName,
        student.email,
        student.phone,
        student.document,
        student.city,
        student.state,
        student.sourceProvider,
        student.externalCustomerId,
        ...student.tags,
        ...student.courses.map((course) => course.product)
      ];

      const matchesText =
        !normalizedQuery ||
        searchableValues.some((value) => normalizeSearchValue(value).includes(normalizedQuery));
      const matchesSource =
        sourceFilter === "all" ||
        student.sourceProvider === sourceFilter ||
        student.courses.some((course) => course.sourceProvider === sourceFilter);
      const matchesStatus =
        statusFilter === "all" ||
        student.status === statusFilter ||
        student.courses.some((course) => course.status === statusFilter);
      const matchesCourse =
        courseFilter === "all" || student.courses.some((course) => course.targetId === courseFilter);

      return matchesText && matchesSource && matchesStatus && matchesCourse;
    })
  ), [courseFilter, normalizedQuery, sourceFilter, statusFilter, students]);

  async function persistStudentChange(updater: StudentListUpdater, title = "Alteracao nao salva") {
    try {
      return await onChangeStudents(updater);
    } catch (error) {
      setAccessNotice({
        message: error instanceof Error ? error.message : "Nao foi possivel persistir a alteracao no CRM.",
        title,
        tone: "error"
      });
      throw error;
    }
  }

  function openNewStudentForm() {
    setFormState({
      ...emptyStudentFormState,
      accessSetup: "invite"
    });
    setAccessNotice(null);
    setModalMode("new");
  }

  function openStudentModal(studentId: string) {
    onSelectStudent(studentId);
    setModalMode("view");
  }

  function openEditStudentForm(student?: AdminStudent | null) {
    const studentToEdit = student ?? selectedStudent;

    if (!studentToEdit) {
      return;
    }

    onSelectStudent(studentToEdit.id);
    setFormState(toStudentFormState(studentToEdit));
    setModalMode("edit");
  }

  function closeStudentModal() {
    setModalMode(null);
  }

  function addAccessHistoryEvent(student: AdminStudent, accessSetup: StudentAccessSetupMode) {
    const location =
      accessSetup === "invite"
        ? "Convite por email"
        : "Senha temporaria";

    void persistStudentChange((current) =>
      current.map((studentRecord) =>
        studentRecord.id === student.id
          ? {
              ...studentRecord,
              accessHistory: [
                {
                  action: "access_email_sent",
                  device: "Sistema",
                  id: `access-email-${Date.now()}`,
                  location,
                  occurredAt: "Agora"
                },
                ...(studentRecord.accessHistory ?? [])
              ]
            }
          : studentRecord
      )
    ).catch(() => undefined);
  }

  function getTemporaryPasswordCopyText(student: AdminStudent, temporaryPassword: string) {
    const firstName = student.fullName.split(/\s+/)[0] || "aluno";

    return [
      `Ola, ${firstName}! Seu acesso a area de membros Bunker707 foi liberado.`,
      `Email: ${student.email}`,
      `Senha temporaria: ${temporaryPassword}`,
      "No primeiro login, a plataforma vai pedir para voce criar uma nova senha."
    ].join("\n");
  }

  async function requestStudentAccessDelivery(
    student: AdminStudent,
    accessSetup: StudentAccessSetupMode,
    temporaryPassword?: string
  ) {
    if (accessSetup === "none") {
      return;
    }

    const method = accessSetup === "invite" ? "invite" : "temporary_password";
    setAccessActionBusy(true);

    try {
      const response = await fetch("/api/admin/students/access", {
        body: JSON.stringify({
          method,
          student: {
            courses: student.courses,
            email: student.email,
            fullName: student.fullName,
            id: student.id,
            phone: student.phone,
            sourceProvider: student.sourceProvider
          },
          temporaryPassword: accessSetup === "manual_password" ? temporaryPassword : undefined
        }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const payload = await response.json() as {
        data?: {
          method: "invite" | "temporary_password";
          status: "sent" | "prepared";
          temporaryPassword?: string;
        };
        error?: string;
      };

      if (!response.ok || !payload.data) {
        setAccessNotice({
          message: payload.error ?? "O aluno foi salvo, mas nao foi possivel preparar o acesso.",
          recipientEmail: student.email,
          title: "Acesso nao enviado",
          tone: "error"
        });
        return;
      }

      addAccessHistoryEvent(student, accessSetup);

      if (payload.data.method === "invite") {
        setAccessNotice({
          message: "O aluno recebeu um email para criar ou redefinir a senha antes de entrar.",
          recipientEmail: student.email,
          title: "Convite enviado",
          tone: "success"
        });
        return;
      }

      const returnedPassword = payload.data.temporaryPassword ?? temporaryPassword ?? "";

      setAccessNotice({
        copyText: returnedPassword ? getTemporaryPasswordCopyText(student, returnedPassword) : undefined,
        message: "Envie esta senha temporaria por um canal de atendimento. Ela nao fica salva no CMS e o aluno sera obrigado a trocar no primeiro login.",
        recipientEmail: student.email,
        temporaryPassword: returnedPassword,
        title: "Senha temporaria criada",
        tone: "success"
      });
    } catch (error) {
      setAccessNotice({
        message: error instanceof Error ? error.message : "O aluno foi salvo, mas o acesso nao foi preparado.",
        recipientEmail: student.email,
        title: "Acesso nao enviado",
        tone: "error"
      });
    } finally {
      setAccessActionBusy(false);
    }
  }

  async function resendSelectedStudentAccess() {
    if (!selectedStudent) {
      return;
    }

    await requestStudentAccessDelivery(selectedStudent, "invite");
  }

  async function resendStudentAccess(student: AdminStudent) {
    onSelectStudent(student.id);
    await requestStudentAccessDelivery(student, "invite");
  }

  function blockAllStudentCourses(student: AdminStudent) {
    void persistStudentChange((current) =>
      current.map((studentRecord) =>
        studentRecord.id === student.id
          ? {
              ...studentRecord,
              courses: studentRecord.courses.map((course) => ({
                ...course,
                endsAt: "Bloqueado manualmente",
                status: "suspended" as AdminEntitlementStatus
              })),
              status: "suspended"
            }
          : studentRecord
      )
    ).catch(() => undefined);
  }

  function moveAllStudentCourses(student: AdminStudent) {
    void persistStudentChange((current) =>
      current.map((studentRecord) =>
        studentRecord.id === student.id
          ? {
              ...studentRecord,
              courses: studentRecord.courses.map((course) => ({
                ...course,
                cohort: getNextCohort(course.cohort, cohorts)
              }))
            }
          : studentRecord
      )
    ).catch(() => undefined);
  }

  function updateFormField(field: keyof StudentFormState, value: string) {
    setFormState((current) => ({
      ...current,
      [field]: value
    }));
  }

  function toggleCourse(courseId: string) {
    setFormState((current) => ({
      ...current,
      courseIds: current.courseIds.includes(courseId)
        ? current.courseIds.filter((id) => id !== courseId)
        : [...current.courseIds, courseId]
    }));
  }

  async function submitStudentForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAccessNotice(null);

    const resolvedAccessSetup = formState.accessSetup;

    if (resolvedAccessSetup === "manual_password" && formState.temporaryPassword.trim().length < 8) {
      setAccessNotice({
        message: "A senha temporaria precisa ter pelo menos 8 caracteres.",
        title: "Senha temporaria invalida",
        tone: "error"
      });
      return;
    }

    setStudentFormSubmitting(true);

    const existingStudent = modalMode === "edit" ? selectedStudent : null;
    const nextStudentId = existingStudent?.id ?? `student-${Date.now()}`;
    const trimmedTags = formState.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    const nextCourses = buildStudentCourses({
      courseIds: formState.courseIds,
      existingCourses: existingStudent?.courses,
      joinedAt: formState.joinedAt,
      sellableProducts,
      sourceProvider: formState.sourceProvider,
      status: formState.status
    });
    const nextStudent: AdminStudent = {
      city: formState.city,
      courses: nextCourses,
      document: formState.document,
      email: formState.email,
      externalCustomerId:
        formState.externalCustomerId || `${formState.sourceProvider.toLowerCase()}-cus-${Date.now()}`,
      fullName: formState.fullName,
      id: nextStudentId,
      joinedAt: formState.joinedAt,
      lastActivityAt: existingStudent?.lastActivityAt ?? "Nunca acessou",
      notes: formState.notes,
      phone: formState.phone,
      sourceProvider: formState.sourceProvider,
      state: formState.state.toUpperCase(),
      status: formState.status,
      tags: trimmedTags,
      accessCount: existingStudent?.accessCount ?? 0,
      accessHistory: existingStudent?.accessHistory ?? [],
      firstAccessAt: existingStudent?.firstAccessAt ?? "Sem acesso"
    };

    try {
      await persistStudentChange((current) => {
        if (existingStudent) {
          return current.map((student) => (student.id === existingStudent.id ? nextStudent : student));
        }

        return [nextStudent, ...current];
      }, existingStudent ? "Aluno nao atualizado" : "Aluno nao cadastrado");
      onSelectStudent(nextStudent.id);

      if (!existingStudent) {
        await requestStudentAccessDelivery(nextStudent, resolvedAccessSetup, formState.temporaryPassword.trim());
      }

      setFormState(emptyStudentFormState);
      setModalMode("view");
    } catch {
      return;
    } finally {
      setStudentFormSubmitting(false);
    }
  }

  function requestStudentRemoval(studentToRemove: AdminStudent) {
    setStudentPendingDeletion(studentToRemove);
  }

  async function confirmStudentRemoval() {
    if (!studentPendingDeletion) {
      return;
    }

    const studentToRemove = studentPendingDeletion;

    try {
      const nextStudents = await persistStudentChange(
        (current) => current.filter((student) => student.id !== studentToRemove.id),
        "Aluno nao excluido"
      );

      if (selectedStudent?.id === studentToRemove.id) {
        onSelectStudent(nextStudents[0]?.id ?? "");
        setModalMode(null);
      }

      setStudentPendingDeletion(null);
    } catch {
      return;
    }
  }

  function removeSelectedStudent() {
    if (!selectedStudent) {
      return;
    }

    requestStudentRemoval(selectedStudent);
  }

  return (
    <div className="-m-4 min-h-[calc(100vh-4rem)] bg-[linear-gradient(180deg,#111217_0%,#0d0e11_100%)] px-4 py-6 text-zinc-100 md:-m-6 md:px-10 md:py-8">
      <section className="min-w-0 space-y-7">
        <StudentsCommandCenter
          courseFilter={courseFilter}
          onCourseFilterChange={setCourseFilter}
          onCreateStudent={openNewStudentForm}
          onQueryChange={setQuery}
          onSourceFilterChange={setSourceFilter}
          onStatusFilterChange={setStatusFilter}
          query={query}
          sellableProducts={sellableProducts}
          sourceFilter={sourceFilter}
          statusFilter={statusFilter}
          students={students}
        />

        {accessNotice ? (
          <StudentAccessNoticePanel notice={accessNotice} onDismiss={() => setAccessNotice(null)} />
        ) : null}

        <section className="overflow-hidden rounded-[8px] border border-white/10 bg-[#15161b] shadow-[0_24px_80px_rgba(0,0,0,0.26)] ring-1 ring-white/[0.025]">
          <div className="overflow-x-auto">
            <Table className="min-w-[72rem]">
              <TableHeader>
                <TableRow className="border-b border-white/10 bg-white/[0.025] hover:bg-white/[0.025]">
                  <TableHead className="w-[31%] px-5 py-3 text-xs font-semibold text-zinc-500">Nome e email</TableHead>
                  <TableHead className="py-3 text-xs font-semibold text-zinc-500">Ultimo acesso</TableHead>
                  <TableHead className="py-3 text-xs font-semibold text-zinc-500">Status</TableHead>
                  <TableHead className="py-3 text-xs font-semibold text-zinc-500">Engajamento</TableHead>
                  <TableHead className="w-[24%] py-3 text-xs font-semibold text-zinc-500">Produtos</TableHead>
                  <TableHead className="px-5 py-3 text-right text-xs font-semibold text-zinc-500">Acoes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredStudents.length > 0 ? (
                  filteredStudents.map((student) => {
                    const isSelected = selectedStudent?.id === student.id;
                    const engagement = getStudentEngagement(student);
                    const accessOverview = getStudentAccessOverview(student);
                    const primaryCourse = student.courses[0];

                    return (
                      <TableRow
                        className={`border-b border-white/10 ${
                          isSelected ? "bg-red-500/[0.055] hover:bg-red-500/[0.075]" : "hover:bg-white/[0.035]"
                        }`}
                        key={student.id}
                      >
                        <TableCell className="px-5 py-4">
                          <button
                            className="flex min-w-0 items-center gap-3 text-left"
                            onClick={() => openStudentModal(student.id)}
                            type="button"
                          >
                            <StudentAvatar avatarUrl={student.avatarUrl} name={student.fullName} />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold text-white">{student.fullName}</span>
                              <span className="mt-1 block truncate text-xs font-medium text-zinc-500">{student.email}</span>
                            </span>
                          </button>
                        </TableCell>

                        <TableCell className="text-sm font-medium text-zinc-400">{student.lastActivityAt}</TableCell>

                        <TableCell>
                          <StatusPill className={getSoftStudentAccessOverviewClassName(student)}>{accessOverview.label}</StatusPill>
                        </TableCell>

                        <TableCell>
                          <span className="text-sm font-semibold text-zinc-300">{engagement}</span>
                        </TableCell>

                        <TableCell>
                          {primaryCourse ? (
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="truncate text-sm font-semibold text-zinc-300">
                                {primaryCourse.product}
                              </span>
                              {student.courses.length > 1 ? (
                                <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.045] px-2 py-0.5 text-xs font-semibold text-zinc-400">
                                  +{student.courses.length - 1}
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-sm font-medium text-zinc-600">Sem produto</span>
                          )}
                        </TableCell>

                        <TableCell className="px-5 text-right">
                          <div className="flex justify-end">
                            <StudentRowActions
                              accessActionBusy={accessActionBusy}
                              onBlockAllCourses={() => blockAllStudentCourses(student)}
                              onEdit={() => openEditStudentForm(student)}
                              onMoveAllCourses={() => moveAllStudentCourses(student)}
                              onOpenDetails={() => openStudentModal(student.id)}
                              onRemove={() => requestStudentRemoval(student)}
                              onResendEmail={() => void resendStudentAccess(student)}
                              student={student}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell className="h-28 text-center text-sm font-medium text-zinc-500" colSpan={6}>
                      Nenhum aluno encontrado com os filtros atuais.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col gap-4 border-t border-white/10 bg-[#111217] px-5 py-5 sm:flex-row sm:items-center sm:justify-center">
            <div className="flex items-center justify-center gap-2">
              {[1, 2, 3, 4, 5].map((page) => (
                <button
                  className={`grid h-9 w-9 place-items-center rounded-[4px] text-sm font-semibold ${
                    page === 1 ? "bg-[var(--accent)] text-white" : "text-zinc-500 hover:bg-white/[0.06] hover:text-white"
                  }`}
                  key={page}
                  type="button"
                >
                  {page}
                </button>
              ))}
            </div>
            <button
              className="h-10 rounded-[7px] border border-white/10 bg-white/[0.045] px-4 text-sm font-semibold text-zinc-300 hover:bg-white/[0.08] hover:text-white"
              type="button"
            >
              15 itens por pagina
            </button>
          </div>
        </section>
      </section>

      <StudentProfileModal
        accessActionBusy={accessActionBusy}
        formSubmitting={studentFormSubmitting}
        formState={formState}
        key={`${modalMode ?? "closed"}-${selectedStudent?.id ?? "none"}`}
        modalMode={modalMode}
        onChange={updateFormField}
        onClose={closeStudentModal}
        onEdit={() => openEditStudentForm()}
        onRemove={removeSelectedStudent}
        onResendAccess={resendSelectedStudentAccess}
        onSubmit={submitStudentForm}
        onToggleCourse={toggleCourse}
        sellableProducts={sellableProducts}
        student={selectedStudent}
      />
      <StudentDeleteConfirmationModal
        onCancel={() => setStudentPendingDeletion(null)}
        onConfirm={() => void confirmStudentRemoval()}
        student={studentPendingDeletion}
      />
    </div>
  );
}

export function AdminDashboard({ initialData }: { initialData: AdminDashboardData }) {
  const [activeView, setActiveView] = useState<AdminView>("overview");
  const [dashboardData, setDashboardData] = useState(initialData);
  const [selectedRecordId, setSelectedRecordId] = useState(initialData.contentRecords[0]?.content.id ?? "");
  const [selectedStudentId, setSelectedStudentId] = useState(initialData.students[0]?.id ?? "");
  const selectedRecord =
    dashboardData.contentRecords.find((record) => record.content.id === selectedRecordId) ??
    dashboardData.contentRecords[0];

  function handleChangeView(view: AdminView) {
    setActiveView(view);
  }

  async function persistStudents(updater: StudentListUpdater) {
    const previousData = dashboardData;
    const nextStudents = typeof updater === "function" ? updater(previousData.students) : updater;
    setDashboardData({
      ...previousData,
      students: nextStudents
    });

    try {
      const response = await fetch("/api/admin/students", {
        body: JSON.stringify({ students: nextStudents }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "PUT"
      });
      const payload = await response.json() as { data?: AdminDashboardData; error?: string };

      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Nao foi possivel salvar os alunos.");
      }

      updateDashboardData(payload.data);
      return payload.data.students;
    } catch (error) {
      setDashboardData(previousData);
      throw error;
    }
  }

  function updateDashboardData(nextData: AdminDashboardData) {
    setDashboardData(nextData);
    setSelectedRecordId((currentRecordId) =>
      nextData.contentRecords.some((record) => record.content.id === currentRecordId)
        ? currentRecordId
        : nextData.contentRecords[0]?.content.id ?? ""
    );
    setSelectedStudentId((currentStudentId) =>
      nextData.students.some((student) => student.id === currentStudentId)
        ? currentStudentId
        : nextData.students[0]?.id ?? ""
    );
  }

  async function persistDashboardCollections(payload: Record<string, unknown>) {
    const response = await fetch("/api/admin/collections", {
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const result = await response.json() as { data?: AdminDashboardData; error?: string };

    if (!response.ok || !result.data) {
      throw new Error(result.error ?? "Nao foi possivel salvar a configuracao.");
    }

    updateDashboardData(result.data);
  }

  async function upsertCombo(combo: AdminProductCombo) {
    const response = await fetch("/api/admin/combos", {
      body: JSON.stringify(combo),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const result = await response.json() as { data?: AdminDashboardData; error?: string };

    if (!response.ok || !result.data) {
      throw new Error(result.error ?? "Nao foi possivel salvar o combo.");
    }

    updateDashboardData(result.data);
  }

  async function deleteCombo(comboId: string) {
    const response = await fetch("/api/admin/combos", {
      body: JSON.stringify({ id: comboId }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "DELETE"
    });
    const result = await response.json() as { data?: AdminDashboardData; error?: string };

    if (!response.ok || !result.data) {
      throw new Error(result.error ?? "Nao foi possivel excluir o combo.");
    }

    updateDashboardData(result.data);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AdminShell activeView={activeView} onChangeView={handleChangeView}>
        {activeView === "overview" ? <AdminOverview data={dashboardData} /> : null}
        {activeView === "students" ? (
          <StudentsView
            cohorts={dashboardData.cohorts}
            onChangeStudents={persistStudents}
            onSelectStudent={setSelectedStudentId}
            selectedStudentId={selectedStudentId}
            sellableProducts={dashboardData.sellableProducts}
            students={dashboardData.students}
          />
        ) : null}
        {activeView === "catalog" ? (
          <CatalogView
            courseModules={dashboardData.courseModules}
            onDashboardDataChange={updateDashboardData}
            records={dashboardData.contentRecords}
            selectedRecord={selectedRecord}
            setSelectedRecord={(record) => setSelectedRecordId(record.content.id)}
          />
        ) : null}
        {activeView === "combos" ? (
          <CombosCommandCenter
            cohorts={dashboardData.cohorts}
            combos={dashboardData.combos}
            onDeleteCombo={deleteCombo}
            onUpsertCombo={upsertCombo}
            products={dashboardData.sellableProducts}
          />
        ) : null}
        {activeView === "structure" ? (
          <StructureView
            cohorts={dashboardData.cohorts}
            courseModules={dashboardData.courseModules}
            onDashboardDataChange={updateDashboardData}
            selectedRecord={selectedRecord}
          />
        ) : null}
        {activeView === "community" ? <CommunityPlaceholder /> : null}
        {activeView === "moderation" ? (
          <ModerationCommandCenter
            blockedWordRules={dashboardData.blockedWordRules}
            items={dashboardData.moderationItems}
            onModerationDataChange={(moderationData) => {
              setDashboardData((currentData) => ({
                ...currentData,
                blockedWordRules: moderationData.blockedWordRules,
                moderationItems: moderationData.moderationItems
              }));
            }}
            products={dashboardData.sellableProducts}
          />
        ) : null}
        {activeView === "ai-agents" ? (
          <AIAgentsCommandCenter
            agents={dashboardData.aiAgents}
            onSaveAgents={(aiAgents) => persistDashboardCollections({ aiAgents })}
            products={dashboardData.sellableProducts}
          />
        ) : null}
        {activeView === "personalization" ? (
          <PersonalizationView
            courseModules={dashboardData.courseModules}
            formationCourses={dashboardData.formationCourses}
            hero={dashboardData.hero}
            homeRows={dashboardData.homeRows}
            homeSections={dashboardData.homeSections}
            records={dashboardData.contentRecords}
          />
        ) : null}
        {activeView === "integrations" ? (
          <IntegrationsCommandCenter
            integrations={dashboardData.integrations}
            onSaveIntegrations={(integrations) => persistDashboardCollections({ integrations })}
          />
        ) : null}
      </AdminShell>

      <div className="pointer-events-none fixed bottom-4 right-4 hidden rounded-full border border-border bg-background/80 px-3 py-1.5 text-xs font-bold text-muted-foreground backdrop-blur md:block">
        Supabase persistido
      </div>
    </div>
  );
}
