"use client";

import { FolderOpen, LockKeyhole, RotateCw, Star } from "lucide-react";
import { useEffect, useReducer, useState, type ReactNode } from "react";
import { MemberButton } from "@/components/member/ui/member-button";
import { MemberEmptyState } from "@/components/member/ui/member-empty-state";
import { MemberMaterialRow } from "@/components/member/ui/member-material-row";
import { MemberSkeletonBlock } from "@/components/member/ui/member-skeletons";
import {
  shouldRefetchLessonMaterials,
  type LessonMaterialLearnerState,
  type StudentLessonMaterial
} from "@/lib/lesson-materials";
import { formatMemberCount } from "@/lib/member-format";

// Aba Materiais da aula: dado real de /api/materials/lessons/[lessonId] (sessao + acesso + liberacao
// validados no servidor). Busca ao abrir a aba, uma vez por aula, e de novo so quando o que o servidor
// JA GRAVOU do aluno (`savedLearner`: avaliou? quanto assistiu?) pode liberar material
// (shouldRefetchLessonMaterials). Nunca usa o estado otimista da tela: a busca sairia antes do
// salvamento e guardaria a resposta "bloqueado".
//
// Material bloqueado pela regra dele chega sem endereco (o servidor nem envia) e mostra o motivo.

type MaterialsResult = {
  available: boolean;
  materials: StudentLessonMaterial[];
};

type CachedMaterials = {
  /** O que estava gravado do aluno quando esta lista foi pedida. */
  fetchedWith: LessonMaterialLearnerState;
  result: MaterialsResult;
};

type MaterialsFailure = {
  message: string;
  requestKey: string;
};

// Cache da sessao do navegador, por aula: trocar de aba ou voltar para a aula nao refaz a busca.
const materialsCache = new Map<string, CachedMaterials>();

function getCacheKey(contentId: string, lessonId: string) {
  return `${contentId}\u0000${lessonId}`;
}

async function fetchLessonMaterials(contentId: string, lessonId: string, signal: AbortSignal) {
  const search = new URLSearchParams({ contentId });
  const response = await fetch(`/api/materials/lessons/${encodeURIComponent(lessonId)}?${search}`, {
    cache: "no-store",
    credentials: "same-origin",
    signal
  });
  const payload = await response.json().catch(() => ({})) as { data?: MaterialsResult; error?: string };

  if (!response.ok || !payload.data) {
    throw new Error(payload.error ?? "Não foi possível carregar os materiais da aula.");
  }

  return payload.data;
}

function MaterialsSkeleton() {
  return (
    <div aria-label="Carregando materiais" className="space-y-2.5" role="status">
      {[0, 1, 2].map((item) => (
        <div className="flex items-center gap-3 rounded-[12px] border border-white/[0.06] bg-white/[0.02] px-3 py-3 sm:px-4" key={item}>
          <MemberSkeletonBlock className="size-11 shrink-0 rounded-[10px]" />
          <span className="min-w-0 flex-1 space-y-2">
            <MemberSkeletonBlock className="h-3.5 w-3/5" />
            <MemberSkeletonBlock className="h-3 w-28" />
          </span>
          <MemberSkeletonBlock className="h-9 w-20 shrink-0 max-sm:w-9" />
        </div>
      ))}
    </div>
  );
}

function MaterialsGroup({
  children,
  count,
  id,
  title
}: {
  children: ReactNode;
  count: number;
  id: string;
  title: string;
}) {
  return (
    <section aria-labelledby={id}>
      <h4 className="mb-2.5 flex items-center gap-2 text-xs font-semibold text-zinc-400" id={id}>
        {title}
        <span className="grid min-w-5 place-items-center rounded-full bg-white/[0.08] px-1.5 py-0.5 text-[11px] font-bold leading-none text-zinc-200">
          {count}
        </span>
      </h4>
      <ul className="grid gap-2">{children}</ul>
    </section>
  );
}

export function LessonMaterialsPanel({
  canRateLesson,
  contentId,
  lessonId,
  lockedNotice,
  onLoaded,
  savedLearner
}: {
  /** O botao de avaliar ja aparece (o aluno assistiu 30% ou ja avaliou). */
  canRateLesson: boolean;
  contentId: string;
  lessonId: string;
  /** Aula ainda fechada (compra ou liberacao): nada e buscado. */
  lockedNotice?: { detail: string; title: string } | null;
  /** Total de materiais da aula (para o numero da aba). Deve ser estavel (useCallback). */
  onLoaded?: (lessonId: string, count: number) => void;
  /** O que o servidor ja gravou do aluno nesta aula (muda so depois de um salvamento confirmado). */
  savedLearner: LessonMaterialLearnerState;
}) {
  const cacheKey = getCacheKey(contentId, lessonId);
  const [failure, setFailure] = useState<MaterialsFailure | null>(null);
  const [, markCacheUpdated] = useReducer((version: number) => version + 1, 0);
  const [retryToken, setRetryToken] = useState(0);
  const isLocked = Boolean(lockedNotice);
  const { maxProgressPercent, rated } = savedLearner;
  // Enquanto refaz a busca (o aluno avaliou ou assistiu mais), mostra a lista anterior desta aula em vez
  // de piscar o esqueleto; o painel e remontado a cada aula (key no pai).
  const cached = materialsCache.get(cacheKey);
  const needsFetch = !isLocked && shouldRefetchLessonMaterials(
    cached ? { fetchedWith: cached.fetchedWith, materials: cached.result.materials } : undefined,
    { maxProgressPercent, rated }
  );
  const requestKey = needsFetch ? `${cacheKey}\u0000${rated ? 1 : 0}\u0000${maxProgressPercent}\u0000${retryToken}` : "";

  useEffect(() => {
    if (!requestKey) {
      return;
    }

    const controller = new AbortController();
    const fetchedWith: LessonMaterialLearnerState = { maxProgressPercent, rated };

    fetchLessonMaterials(contentId, lessonId, controller.signal)
      .then((result) => {
        materialsCache.set(cacheKey, { fetchedWith, result });
        setFailure(null);
        markCacheUpdated();
        onLoaded?.(lessonId, result.materials.length);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setFailure({
          message: error instanceof Error ? error.message : "Não foi possível carregar os materiais da aula.",
          requestKey
        });
      });

    return () => controller.abort();
  }, [cacheKey, contentId, lessonId, maxProgressPercent, onLoaded, rated, requestKey]);

  if (lockedNotice) {
    return (
      <MemberEmptyState
        description={lockedNotice.detail}
        icon={LockKeyhole}
        size="compact"
        title="Materiais liberados junto com a aula"
      />
    );
  }

  // O erro so aparece sem lista guardada; se so a atualizacao de uma lista ja exibida falhou, ela fica.
  if (!cached && failure && failure.requestKey === requestKey) {
    return (
      <div
        className="flex flex-col items-start gap-3 rounded-[12px] border border-red-400/20 bg-red-500/[0.07] px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
        role="alert"
      >
        <p className="text-sm font-medium text-red-100">{failure.message}</p>
        <MemberButton
          onClick={() => {
            setFailure(null);
            setRetryToken((token) => token + 1);
          }}
          size="sm"
          variant="secondary"
        >
          <RotateCw aria-hidden="true" />
          Tentar de novo
        </MemberButton>
      </div>
    );
  }

  if (!cached) {
    return <MaterialsSkeleton />;
  }

  const materials = cached.result.materials;

  if (!cached.result.available || materials.length === 0) {
    return (
      <MemberEmptyState
        description="Quando o professor publicar arquivos de apoio, eles aparecem aqui."
        icon={FolderOpen}
        size="compact"
        title="Esta aula ainda não tem materiais"
      />
    );
  }

  const unlocked = materials.filter((material) => !material.locked);
  const locked = materials.filter((material) => material.locked);
  const needsRating = locked.some((material) => material.lockReason === "lesson_rated");
  const summary = [
    formatMemberCount(materials.length, "material", "materiais"),
    locked.length > 0 ? `${locked.length} para liberar` : ""
  ].filter(Boolean).join(" · ");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-white">Materiais de apoio</h3>
          <p className="mt-0.5 text-[13px] text-zinc-400">{summary}</p>
        </div>
      </div>

      {unlocked.length > 0 ? (
        <MaterialsGroup count={unlocked.length} id={`lesson-materials-available-${lessonId}`} title="Disponíveis">
          {unlocked.map((material) => (
            <li className="min-w-0" key={material.id}>
              <MemberMaterialRow material={material} />
            </li>
          ))}
        </MaterialsGroup>
      ) : null}

      {locked.length > 0 ? (
        <MaterialsGroup count={locked.length} id={`lesson-materials-locked-${lessonId}`} title="Para liberar">
          {locked.map((material) => (
            <li className="min-w-0" key={material.id}>
              <MemberMaterialRow material={material} />
            </li>
          ))}
          {needsRating ? (
            <li className="flex items-center gap-2 px-1 pt-1 text-xs font-medium text-zinc-400">
              <Star aria-hidden="true" className="size-3.5 shrink-0 text-amber-300" />
              {canRateLesson
                ? "Avalie a aula pelo botão de polegar, ao lado de Concluir, para liberar."
                : "Assista pelo menos 30% da aula para poder avaliar e liberar."}
            </li>
          ) : null}
        </MaterialsGroup>
      ) : null}
    </div>
  );
}
