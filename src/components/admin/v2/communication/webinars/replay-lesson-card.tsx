"use client";

import { useEffect, useState } from "react";
import { PRODUCT_FORMAT_LABELS, PRODUCT_SITUATION_LABELS } from "@/server/catalog/model";
import type { ProductOption } from "@/server/catalog/types";
import { WEBINAR_ADMIN_COPY, WEBINAR_EDITOR_LIMITS } from "@/server/webinars/editor-model";
import type { ReplayLessonTarget } from "@/server/webinars/model";
import { listReplayLessonModules } from "@/server/webinars/replay-lesson-actions";
import { AdminField, adminInputClass } from "../../form";
import { AdminSwitch } from "../../settings/kit";
import { ProductPicker, type ProductPickerItem } from "../../storefront/product-picker";
import type { CardProps } from "./webinar-editor-cards";

// Os campos do destino do replay (docs/30 §2.2 e §6.8) e o card Publicar replay como aula do editor do webinario. Ficam
// num arquivo so deles porque leem os modulos do produto por uma Server Action (listReplayLessonModules): os outros
// cards (webinar-editor-cards.tsx) nao importam acao nenhuma. O console usa os mesmos campos (console-replay-lesson.tsx).

const copy = WEBINAR_ADMIN_COPY.fields;

/**
 * Os produtos do seletor, no formato do ProductPicker (o mesmo desenho de toPickerItems do editor; repetido aqui para o
 * console nao carregar os outros cards do editor so por causa desta funcao).
 */
export function replayPickerItems(products: readonly ProductOption[]): ProductPickerItem[] {
  return products.map((product) => ({
    accent: product.accent,
    coverUrl: product.coverUrl,
    detail: PRODUCT_FORMAT_LABELS[product.format],
    flags: product.situation === "published" ? [] : [{ label: PRODUCT_SITUATION_LABELS[product.situation], tone: "muted" as const }],
    id: product.id,
    title: product.title
  }));
}

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

type ReplayLessonFieldsProps = {
  disabled: boolean;
  /** O comeco dos ids dos campos: "webinar" no editor (o foco do erro procura "webinar-<campo>"), "console" no console. */
  idPrefix?: string;
  onBlur?: (key: string) => void;
  onChange: (target: ReplayLessonTarget | null) => void;
  pickerItems: readonly ProductPickerItem[];
  productError?: string;
  target: ReplayLessonTarget | null;
  titleError?: string;
};

/**
 * O destino da aula do replay (docs/30 §2.2 e §6.8): o produto, o modulo pela lista do produto (sem escolha, o ultimo
 * modulo; produto sem modulo ganha um chamado Lives), o titulo (vazio, o do webinario) e publicar sozinho, que nasce
 * ligado. Trocar o produto limpa o modulo, que era do produto de antes. Os mesmos campos no card do editor
 * (ReplayLessonCard) e no cartao do painel Gravação do console (console-replay-lesson.tsx).
 */
export function ReplayLessonFields({ disabled, idPrefix = "webinar", onBlur = () => {}, onChange, pickerItems, productError, target, titleError }: ReplayLessonFieldsProps) {
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
  const id = (field: string) => `${idPrefix}-replayLessonTarget-${field}`;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <AdminSwitch
        checked={target !== null}
        disabled={disabled}
        id={`${idPrefix}-replayLesson`}
        label={copy.replayLesson}
        onCheckedChange={(checked) => onChange(checked ? { autoPublish: true, moduleId: null, productId: "", title: null } : null)}
      />
      {target ? (
        <>
          <AdminField error={productError} id={id("productId")} label={copy.product}>
            <ProductPicker
              disabled={disabled}
              error={productError}
              id={id("productId")}
              items={pickerItems}
              mode="single"
              onChange={(ids) => {
                const productId = ids[0] ?? "";

                onChange({ ...target, moduleId: productId === target.productId ? target.moduleId : null, productId });
                onBlur("replayLessonTarget.productId");
              }}
              value={target.productId ? [target.productId] : []}
            />
          </AdminField>
          <AdminField hint={moduleHint} id={id("moduleId")} label={copy.replayLessonModule} optional>
            <select
              className={adminInputClass}
              disabled={disabled || !target.productId || options.loading}
              id={id("moduleId")}
              onBlur={() => onBlur("replayLessonTarget.moduleId")}
              onChange={(event) => onChange({ ...target, moduleId: event.target.value || null })}
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
          <AdminField error={titleError} hint={copy.replayLessonTitleHint} id={id("title")} label={copy.replayLessonTitle} optional>
            <input
              className={adminInputClass}
              disabled={disabled}
              id={id("title")}
              maxLength={WEBINAR_EDITOR_LIMITS.title}
              onBlur={() => onBlur("replayLessonTarget.title")}
              onChange={(event) => onChange({ ...target, title: event.target.value })}
              type="text"
              value={target.title ?? ""}
            />
          </AdminField>
          <AdminSwitch
            checked={target.autoPublish}
            description={copy.replayAutoPublishHint}
            disabled={disabled}
            id={id("autoPublish")}
            label={copy.replayAutoPublish}
            onCheckedChange={(autoPublish) => onChange({ ...target, autoPublish })}
          />
        </>
      ) : null}
    </div>
  );
}

/** O card Publicar replay como aula do editor: os campos sobre o rascunho do webinario. */
export function ReplayLessonCard({ disabled, draft, errorFor, onBlur, onChange, pickerItems }: CardProps & { pickerItems: readonly ProductPickerItem[] }) {
  return (
    <ReplayLessonFields
      disabled={disabled}
      onBlur={onBlur}
      onChange={(replayLessonTarget) => onChange({ replayLessonTarget })}
      pickerItems={pickerItems}
      productError={errorFor("replayLessonTarget.productId")}
      target={draft.replayLessonTarget}
      titleError={errorFor("replayLessonTarget.title")}
    />
  );
}
