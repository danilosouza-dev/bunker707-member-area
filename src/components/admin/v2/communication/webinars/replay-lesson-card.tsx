"use client";

import { useEffect, useState } from "react";
import { listReplayLessonModules } from "@/server/webinars/actions";
import { WEBINAR_ADMIN_COPY, WEBINAR_EDITOR_LIMITS } from "@/server/webinars/editor-model";
import { AdminField, adminInputClass } from "../../form";
import { AdminSwitch } from "../../settings/kit";
import { ProductPicker, type ProductPickerItem } from "../../storefront/product-picker";
import type { CardProps } from "./webinar-editor-cards";

// O card Publicar replay como aula do editor do webinario (docs/30 §2.2 e §6.8). Fica num arquivo so dele porque le os
// modulos do produto por uma Server Action (listReplayLessonModules): os outros cards (webinar-editor-cards.tsx) nao
// importam acao nenhuma.

const copy = WEBINAR_ADMIN_COPY.fields;

type ReplayModuleOptions = { failed: boolean; loading: boolean; modules: readonly { id: string; title: string }[]; productId: string };

/**
 * Os modulos do produto escolhido (listReplayLessonModules), lidos quando o produto muda. Enquanto a lista do produto
 * de agora nao chegou, `loading`; a resposta de um produto que ja saiu da tela e descartada.
 */
function useReplayLessonModules(productId: string): ReplayModuleOptions {
  const [state, setState] = useState<ReplayModuleOptions>({ failed: false, loading: false, modules: [], productId: "" });

  useEffect(() => {
    if (!productId) {
      return;
    }

    let cancelled = false;

    void listReplayLessonModules({ productId })
      .then((result) => (result.ok ? { failed: false, loading: false, modules: result.data.modules, productId } : { failed: true, loading: false, modules: [], productId }))
      .catch(() => ({ failed: true, loading: false, modules: [], productId }))
      .then((next) => {
        if (!cancelled) {
          setState(next);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [productId]);

  return state.productId === productId ? state : { failed: false, loading: productId !== "", modules: [], productId };
}

/**
 * O destino da aula do replay (docs/30 §2.2 e §6.8): o produto, o modulo pela lista do produto (sem escolha, o ultimo
 * modulo; produto sem modulo ganha um chamado Lives), o titulo (vazio, o do webinario) e publicar sozinho, que nasce
 * ligado. Trocar o produto limpa o modulo, que era do produto de antes.
 */
export function ReplayLessonCard({ disabled, draft, errorFor, onBlur, onChange, pickerItems }: CardProps & { pickerItems: readonly ProductPickerItem[] }) {
  const target = draft.replayLessonTarget;
  const options = useReplayLessonModules(target?.productId ?? "");
  const savedModuleId = target?.moduleId ?? "";
  const savedModuleListed = options.modules.some((module) => module.id === savedModuleId);
  const moduleHint = !target?.productId
    ? copy.replayLessonModuleNeedsProduct
    : options.failed
      ? copy.replayLessonModuleFailed
      : !options.loading && options.modules.length === 0
        ? copy.replayLessonModuleEmpty
        : copy.replayLessonModuleHint;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <AdminSwitch
        checked={target !== null}
        disabled={disabled}
        id="webinar-replayLesson"
        label={copy.replayLesson}
        onCheckedChange={(checked) => onChange({ replayLessonTarget: checked ? { autoPublish: true, moduleId: null, productId: "", title: null } : null })}
      />
      {target ? (
        <>
          <AdminField error={errorFor("replayLessonTarget.productId")} id="webinar-replayLessonTarget-productId" label={copy.product}>
            <ProductPicker
              disabled={disabled}
              error={errorFor("replayLessonTarget.productId")}
              id="webinar-replayLessonTarget-productId"
              items={pickerItems}
              mode="single"
              onChange={(ids) => {
                const productId = ids[0] ?? "";

                onChange({ replayLessonTarget: { ...target, moduleId: productId === target.productId ? target.moduleId : null, productId } });
                onBlur("replayLessonTarget.productId");
              }}
              value={target.productId ? [target.productId] : []}
            />
          </AdminField>
          <AdminField error={errorFor("replayLessonTarget.moduleId")} hint={moduleHint} id="webinar-replayLessonTarget-moduleId" label={copy.replayLessonModule} optional>
            <select
              className={adminInputClass}
              disabled={disabled || !target.productId || options.loading}
              id="webinar-replayLessonTarget-moduleId"
              onBlur={() => onBlur("replayLessonTarget.moduleId")}
              onChange={(event) => onChange({ replayLessonTarget: { ...target, moduleId: event.target.value || null } })}
              value={savedModuleId}
            >
              <option value="">{options.loading ? copy.replayLessonModuleLoading : copy.replayLessonModuleAuto}</option>
              {options.modules.map((module) => (
                <option key={module.id} value={module.id}>
                  {module.title}
                </option>
              ))}
              {savedModuleId && !savedModuleListed ? <option value={savedModuleId}>{options.loading || options.failed ? savedModuleId : copy.replayLessonModuleGone}</option> : null}
            </select>
          </AdminField>
          <AdminField error={errorFor("replayLessonTarget.title")} hint={copy.replayLessonTitleHint} id="webinar-replayLessonTarget-title" label={copy.replayLessonTitle} optional>
            <input
              className={adminInputClass}
              disabled={disabled}
              id="webinar-replayLessonTarget-title"
              maxLength={WEBINAR_EDITOR_LIMITS.title}
              onBlur={() => onBlur("replayLessonTarget.title")}
              onChange={(event) => onChange({ replayLessonTarget: { ...target, title: event.target.value } })}
              type="text"
              value={target.title ?? ""}
            />
          </AdminField>
          <AdminSwitch
            checked={target.autoPublish}
            description={copy.replayAutoPublishHint}
            disabled={disabled}
            id="webinar-replayLessonTarget-autoPublish"
            label={copy.replayAutoPublish}
            onCheckedChange={(autoPublish) => onChange({ replayLessonTarget: { ...target, autoPublish } })}
          />
        </>
      ) : null}
    </div>
  );
}
