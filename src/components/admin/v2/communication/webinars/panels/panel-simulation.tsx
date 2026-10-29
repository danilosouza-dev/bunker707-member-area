import { FlaskConical } from "lucide-react";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { panelNumberText, type PanelSimulationView } from "@/server/webinars/panel-model";

// O bloco Simulacao do painel Lives gravadas (docs/30 §3.5; D6, D10, M6): sempre o ultimo da aba, com o fundo
// diferente (superficie 2 e borda tracejada) e a frase "Estes números são da simulação e não entram em nenhum outro
// número." logo abaixo do titulo. Le so o que panelSimulationOf devolve (as linhas sim_* e as regras); o numero real
// de participantes aparece ao lado do contador para a equipe comparar. Sem a 202610300003, tudo "—".

const COPY = WEBINAR_COPY.paineis.simulacao;

function Line({ label, value, detail }: { detail?: string | null; label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 border-t border-[var(--border-subtle)] pt-3 first:border-t-0 first:pt-0 md:flex-row md:items-baseline md:justify-between md:gap-4">
      <dt className="text-[13px] leading-5 text-[var(--text-secondary)]">{label}</dt>
      <dd className="flex min-w-0 flex-col text-sm leading-5 font-medium text-[var(--text-primary)] tabular-nums md:items-end">
        <span className="[overflow-wrap:anywhere]">{value}</span>
        {detail ? <span className="text-xs leading-4 font-normal text-[var(--text-tertiary)]">{detail}</span> : null}
      </dd>
    </div>
  );
}

export function PanelSimulationBlock({ simulation }: { simulation: PanelSimulationView }) {
  const rules = simulation.rules.length > 0 ? simulation.rules.join(" · ") : simulation.available ? COPY.semRegra : "—";

  return (
    <section
      aria-labelledby="painel-simulacao-titulo"
      className={cn("flex min-w-0 flex-col gap-4 rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--surface-2)] p-4")}
      data-panel-simulation=""
    >
      <header className="flex min-w-0 items-start gap-2.5">
        <FlaskConical aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--text-tertiary)]" />
        <div className="min-w-0">
          <h3 className="text-base leading-6 font-semibold text-[var(--text-primary)]" id="painel-simulacao-titulo">
            {COPY.titulo}
          </h3>
          <p className="mt-0.5 text-[13px] leading-5 text-[var(--text-secondary)]">{COPY.aviso}</p>
          {!simulation.available ? <p className="mt-1 text-xs leading-4 text-[var(--text-tertiary)]">{COPY.pendente}</p> : null}
        </div>
      </header>
      <dl className="flex min-w-0 flex-col gap-3">
        <Line label={COPY.selo} value={COPY.seloLigado(simulation.badge.on, simulation.badge.total)} />
        <Line label={COPY.regraDoContador} value={rules} />
        <Line
          detail={simulation.realParticipants !== null ? COPY.comparacaoReal(simulation.realParticipants) : null}
          label={COPY.contadorMaximo}
          value={panelNumberText(simulation.counterMax)}
        />
        <Line label={COPY.entradas} value={panelNumberText(simulation.joinsShown)} />
        <Line label={COPY.avisosDeVenda} value={panelNumberText(simulation.saleNoticesShown)} />
        <Line label={COPY.comentariosDoRoteiro} value={panelNumberText(simulation.scriptFired)} />
      </dl>
    </section>
  );
}
