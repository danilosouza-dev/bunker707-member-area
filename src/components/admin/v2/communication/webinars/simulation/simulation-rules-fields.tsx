"use client";

import { Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { SIMULATION_LIMITS, type SimulatedCountMode } from "@/server/webinars/model";
import { AdminField, PillGroup, adminInputClass, fieldDescribedBy } from "../../../form";
import { addSaleNotice, removeSaleNotice, simulationCountHint, updateSaleNotice, type SimulationForm } from "./simulation-card-model";

// Os tres blocos da Simulacao de uma sessao gravada (docs/30 §2.2, §4.3 e §6.6): Contador de plateia (So o real /
// Real + numero fixo / Real + faixa que varia, com minimo, maximo e variacao), Entradas e saidas (desligadas / a cada
// N s, no maximo M, com nomes genericos) e Notificacoes de venda (desligadas por padrao; a lista de texto + minuto do
// video). So os campos: quem usa guarda o formulario (simulation-card-model.ts), mostra a frase de §8.6 e salva. O card
// Simulacao usa por sessao; o "Comeca quando voce entra" (4e) pode usar no modelo da sessao.

const COPY = WEBINAR_COPY.simulacao.card;

const COUNT_OPTIONS: { label: string; value: SimulatedCountMode }[] = [
  { label: COPY.contadorModos.off, value: "off" },
  { label: COPY.contadorModos.fixed, value: "fixed" },
  { label: COPY.contadorModos.curve, value: "curve" }
];
const ONOFF_JOINS = [
  { label: COPY.entradasDesligadas, value: "off" as const },
  { label: COPY.entradasLigadas, value: "on" as const }
];
const ONOFF_SALES = [
  { label: COPY.avisosDesligados, value: "off" as const },
  { label: COPY.avisosLigados, value: "on" as const }
];

export type SimulationRulesFieldsProps = {
  disabled: boolean;
  /** Os erros de simulationRulesOfForm (por campo). */
  errors: Record<string, string>;
  form: SimulationForm;
  /** Prefixo unico dos ids (useId de quem usa + a sessao). */
  idBase: string;
  onChange: (next: SimulationForm) => void;
};

function Block({ children, hint, id, kind, title }: { children: ReactNode; hint?: ReactNode; id: string; kind: string; title: string }) {
  return (
    <div aria-labelledby={`${id}-titulo`} className="flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--border-subtle)] p-3" data-simulation-block={kind} role="group">
      <span className="text-[13px] leading-5 font-semibold text-[var(--text-primary)]" id={`${id}-titulo`}>
        {title}
      </span>
      {children}
      {hint ? <p className="text-xs leading-5 text-[var(--text-secondary)]">{hint}</p> : null}
    </div>
  );
}

function NumberField(props: { disabled: boolean; error?: string; hint?: ReactNode; id: string; label: string; max: number; min: number; onChange: (value: string) => void; value: string }) {
  return (
    <AdminField error={props.error} hint={props.hint} id={props.id} label={props.label}>
      <input
        aria-describedby={fieldDescribedBy(props.id, { error: props.error, hint: props.hint })}
        aria-invalid={props.error ? true : undefined}
        className={adminInputClass}
        disabled={props.disabled}
        id={props.id}
        inputMode="numeric"
        max={props.max}
        min={props.min}
        onChange={(event) => props.onChange(event.target.value)}
        step={1}
        type="number"
        value={props.value}
      />
    </AdminField>
  );
}

export function SimulationRulesFields({ disabled, errors, form, idBase, onChange }: SimulationRulesFieldsProps) {
  const patch = (next: Partial<SimulationForm>) => onChange({ ...form, ...next });
  const salesFull = form.sales.length >= SIMULATION_LIMITS.saleNoticesMax;

  return (
    <div className="flex min-w-0 flex-col gap-3" data-simulation-rules="">
      <Block hint={simulationCountHint(form)} id={`${idBase}-contador`} kind="contador" title={COPY.contador}>
        <PillGroup ariaLabel={COPY.contador} disabled={disabled} name={`${idBase}-contador-modo`} onChange={(countMode) => patch({ countMode })} options={COUNT_OPTIONS} value={form.countMode} />
        {form.countMode === "fixed" ? (
          <NumberField
            disabled={disabled}
            error={errors.base}
            id={`${idBase}-base`}
            label={COPY.somar}
            max={SIMULATION_LIMITS.countMax}
            min={0}
            onChange={(base) => patch({ base, peak: base })}
            value={form.base}
          />
        ) : null}
        {form.countMode === "curve" ? (
          <div className="grid min-w-0 gap-3 sm:grid-cols-3">
            <NumberField disabled={disabled} error={errors.base} id={`${idBase}-base`} label={COPY.minimo} max={SIMULATION_LIMITS.countMax} min={0} onChange={(base) => patch({ base })} value={form.base} />
            <NumberField disabled={disabled} error={errors.peak} id={`${idBase}-peak`} label={COPY.maximo} max={SIMULATION_LIMITS.countMax} min={0} onChange={(peak) => patch({ peak })} value={form.peak} />
            <NumberField
              disabled={disabled}
              error={errors.jitter}
              hint={COPY.variacaoDica}
              id={`${idBase}-jitter`}
              label={COPY.variacao}
              max={SIMULATION_LIMITS.jitterMax}
              min={0}
              onChange={(jitter) => patch({ jitter })}
              value={form.jitter}
            />
          </div>
        ) : null}
      </Block>

      <Block hint={COPY.entradasDica} id={`${idBase}-entradas`} kind="entradas" title={COPY.entradas}>
        <PillGroup
          ariaLabel={COPY.entradas}
          disabled={disabled}
          name={`${idBase}-entradas-modo`}
          onChange={(value) => patch({ joinsEnabled: value === "on" })}
          options={ONOFF_JOINS}
          value={form.joinsEnabled ? "on" : "off"}
        />
        {form.joinsEnabled ? (
          <>
            <p className="text-xs leading-5 text-[var(--text-secondary)]" data-simulation-joins-summary="">
              {COPY.entradasACada(/^\d{1,9}$/.test(form.everySeconds.trim()) ? Number(form.everySeconds.trim()) : 0)}
            </p>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <NumberField
                disabled={disabled}
                error={errors.everySeconds}
                id={`${idBase}-every`}
                label={COPY.aCadaSegundos}
                max={SIMULATION_LIMITS.joinsEverySecondsMax}
                min={SIMULATION_LIMITS.joinsEverySecondsMin}
                onChange={(everySeconds) => patch({ everySeconds })}
                value={form.everySeconds}
              />
              <NumberField
                disabled={disabled}
                error={errors.joinsMax}
                id={`${idBase}-max`}
                label={COPY.noMaximo}
                max={SIMULATION_LIMITS.joinsMax}
                min={0}
                onChange={(joinsMax) => patch({ joinsMax })}
                value={form.joinsMax}
              />
            </div>
          </>
        ) : null}
      </Block>

      <Block hint={COPY.avisosDica} id={`${idBase}-avisos`} kind="avisos" title={COPY.avisosDeVenda}>
        <PillGroup
          ariaLabel={COPY.avisosDeVenda}
          disabled={disabled}
          name={`${idBase}-avisos-modo`}
          onChange={(value) => patch({ salesEnabled: value === "on" })}
          options={ONOFF_SALES}
          value={form.salesEnabled ? "on" : "off"}
        />
        {form.salesEnabled ? (
          <div className="flex min-w-0 flex-col gap-3">
            {form.sales.length === 0 ? <p className="text-xs leading-5 text-[var(--text-secondary)]">{COPY.semAvisos}</p> : null}
            <ul className="flex min-w-0 flex-col gap-3">
              {form.sales.map((item, index) => {
                const textId = `${idBase}-aviso-${item.key}-texto`;
                const minuteId = `${idBase}-aviso-${item.key}-minuto`;
                const textError = errors[`sales.${item.key}.text`];
                const minuteError = errors[`sales.${item.key}.minute`];
                return (
                  <li className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-start" data-simulation-sale={index} key={item.key}>
                    <AdminField error={textError} id={textId} label={COPY.avisoTexto}>
                      <input
                        aria-describedby={fieldDescribedBy(textId, { error: textError })}
                        aria-invalid={textError ? true : undefined}
                        className={adminInputClass}
                        disabled={disabled}
                        id={textId}
                        maxLength={SIMULATION_LIMITS.saleNoticeText}
                        onChange={(event) => onChange(updateSaleNotice(form, item.key, { text: event.target.value }))}
                        placeholder={COPY.avisoExemplo}
                        type="text"
                        value={item.text}
                      />
                    </AdminField>
                    <AdminField error={minuteError} hint={COPY.avisoMinutoDica} id={minuteId} label={COPY.avisoMinuto}>
                      <input
                        aria-describedby={fieldDescribedBy(minuteId, { error: minuteError, hint: COPY.avisoMinutoDica })}
                        aria-invalid={minuteError ? true : undefined}
                        className={adminInputClass}
                        disabled={disabled}
                        id={minuteId}
                        inputMode="numeric"
                        onChange={(event) => onChange(updateSaleNotice(form, item.key, { minute: event.target.value }))}
                        placeholder="12:30"
                        type="text"
                        value={item.minute}
                      />
                    </AdminField>
                    <Button
                      aria-label={`${COPY.removerAviso} ${index + 1}`}
                      className="mt-6 size-10 px-0 text-[var(--text-secondary)] pointer-coarse:size-11"
                      disabled={disabled}
                      onClick={() => onChange(removeSaleNotice(form, item.key))}
                      title={COPY.removerAviso}
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
            {errors.sales ? <p className="text-[13px] leading-5 text-[var(--error)]">{errors.sales}</p> : null}
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Button className="px-3" disabled={disabled || salesFull} onClick={() => onChange(addSaleNotice(form))} type="button" variant="secondary">
                <Plus aria-hidden="true" className="size-4" />
                {COPY.adicionarAviso}
              </Button>
              <span className="text-xs leading-5 text-[var(--text-tertiary)]">{COPY.limiteAvisos(SIMULATION_LIMITS.saleNoticesMax)}</span>
            </div>
          </div>
        ) : null}
      </Block>
    </div>
  );
}
