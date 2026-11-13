"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { WEBINAR_ADMIN_COPY } from "@/server/webinars/editor-model";
import type { ReplayLessonTarget } from "@/server/webinars/model";
import { getReplayLessonSetup, saveReplayLessonTarget, type ReplayLessonSetup } from "@/server/webinars/replay-lesson-actions";
import { SectionCard } from "../../../settings/kit";
import { adminToast } from "../../../toast";
import { ReplayLessonFields, replayPickerItems } from "../replay-lesson-card";

// O destino do replay no painel Gravação do console (docs/30 §6.8, D114; pedido do produtor de 13/11/2026: "na hora de
// eu botar para gravar, eu consigo configurar isso?"). Os mesmos campos do card Publicar replay como aula do editor,
// sobre o mesmo destino do webinario (replay_lesson_target), com o proprio Salvar: o console nao tem o rascunho do
// editor. Le o destino, os produtos e a aula que ja existe quando o painel abre (getReplayLessonSetup); o Salvar grava
// so o destino (saveReplayLessonTarget) e vale para o proximo replay que nascer. A aula que ja existe nao e mexida.

const copy = WEBINAR_ADMIN_COPY.replayConsole;

/** O destino como o servidor grava: titulo e modulo sem espacos nas pontas, vazio vira nulo. */
function canonical(target: ReplayLessonTarget | null): ReplayLessonTarget | null {
  return target ? { autoPublish: target.autoPublish, moduleId: target.moduleId?.trim() || null, productId: target.productId, title: target.title?.trim() || null } : null;
}

type Problem = { message: string; onProduct: boolean };

export function ConsoleReplayLesson({ canWrite, webinarId }: { canWrite: boolean; webinarId: string }) {
  const [setup, setSetup] = useState<ReplayLessonSetup | null>(null);
  const [failed, setFailed] = useState(false);
  const [target, setTarget] = useState<ReplayLessonTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  useEffect(() => {
    let cancelled = false;

    void getReplayLessonSetup({ id: webinarId })
      .then((result) => (result.ok ? result.data : null))
      .catch(() => null)
      .then((data) => {
        if (cancelled) {
          return;
        }

        if (data) {
          setSetup(data);
          setTarget(data.target);
        } else {
          setFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [webinarId]);

  const dirty = setup !== null && JSON.stringify(canonical(target)) !== JSON.stringify(canonical(setup.target));

  async function save() {
    if (!setup || saving) {
      return;
    }

    if (target && !target.productId) {
      setProblem({ message: WEBINAR_ADMIN_COPY.problems.replayLessonNeedsProduct, onProduct: true });
      return;
    }

    setSaving(true);
    setProblem(null);

    try {
      const result = await saveReplayLessonTarget({ id: webinarId, target: canonical(target) });

      if (result.ok) {
        setSetup({ ...setup, target: result.data.target });
        setTarget(result.data.target);
        adminToast.success(copy.saved);
        return;
      }

      const raw = result.fieldErrors?.["replayLessonTarget.productId"];
      const onProduct = Array.isArray(raw) ? raw[0] : raw;

      setProblem({ message: onProduct ?? result.error, onProduct: Boolean(onProduct) });
    } catch {
      setProblem({ message: WEBINAR_ADMIN_COPY.failures.generic, onProduct: false });
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard bodyClassName="flex min-w-0 flex-col gap-3" description={copy.description} title={WEBINAR_ADMIN_COPY.cards.replayAula.title} titleId="console-replay-lesson-title">
      {failed ? (
        <p className="text-[13px] leading-5 text-[var(--text-secondary)]" data-replay-lesson="failed" role="status">
          {copy.failed}
        </p>
      ) : !setup ? (
        <p className="text-[13px] leading-5 text-[var(--text-secondary)]" data-replay-lesson="loading" role="status">
          {copy.loading}
        </p>
      ) : (
        <>
          {setup.lesson ? (
            <p className="text-[13px] leading-5 text-[var(--text-secondary)]" data-replay-lesson="existing">
              {copy.existing(setup.lesson.title)}
            </p>
          ) : null}
          <ReplayLessonFields
            disabled={!canWrite || saving}
            idPrefix="console"
            onChange={(next) => {
              setTarget(next);
              setProblem(null);
            }}
            pickerItems={replayPickerItems(setup.products)}
            productError={problem?.onProduct ? problem.message : undefined}
            target={target}
          />
          {problem && !problem.onProduct ? (
            <p className="text-[13px] leading-5 text-[var(--error)]" role="alert">
              {problem.message}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button className="px-4" disabled={!canWrite || saving || !dirty} onClick={() => void save()} type="button">
              {copy.save}
            </Button>
          </div>
        </>
      )}
    </SectionCard>
  );
}
