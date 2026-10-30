import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { consolePresenceMinuteLabel, type ConsolePresence } from "@/server/webinars/console-presence-model";
import { SectionCard } from "../../../settings/kit";

// O painel Presenca do console (docs/30 §2.4): presentes agora (o balde atual, do retrato de 5 s), o pico da sessao, as
// mensagens de alunos no ultimo minuto (com a media da janela) e a curva dos ultimos 30 minutos em barras (um minuto por
// barra, o maior numero de presentes do minuto). Os numeros vem da visao do relatorio em cache de 60 s; o SVG tem o
// resumo no aria-label e cada barra o proprio <title>. Sem o painel (Replay, antes de comecar), nada aparece.

const copy = WEBINAR_COPY.paineis.consolePresenca;
const integer = new Intl.NumberFormat("pt-BR");
const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

const WIDTH = 300;
const HEIGHT = 72;

function Stat({ detail, label, value }: { detail?: string | null; label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs leading-4 text-[var(--text-tertiary)]">{label}</dt>
      <dd className="text-lg leading-6 font-semibold text-[var(--text-primary)] tabular-nums">{value}</dd>
      {detail ? <dd className="text-xs leading-4 text-[var(--text-tertiary)]">{detail}</dd> : null}
    </div>
  );
}

export function ConsolePresencePanel({ presence, presentNow }: { presence: ConsolePresence; presentNow: number }) {
  const max = Math.max(1, ...presence.curve.map((point) => point.present));
  const slots = Math.max(presence.curve.length, 1);
  const barWidth = WIDTH / slots;
  const anyone = presence.curve.some((point) => point.present > 0) || presentNow > 0;

  return (
    <SectionCard description={copy.descricao} title={copy.titulo} titleId="console-presence-title">
      <dl className="grid min-w-0 grid-cols-3 gap-3" data-console-presence="">
        <Stat label={copy.presentesAgora} value={integer.format(presentNow)} />
        <Stat label={copy.pico} value={presence.peak ? copy.picoEm(presence.peak.present, consolePresenceMinuteLabel(presence.peak.minute)) : "—"} />
        <Stat detail={copy.mediaPorMinuto(decimal.format(presence.messagesPerMinuteAvg))} label={copy.mensagensUltimoMinuto} value={integer.format(presence.messagesLastMinute)} />
      </dl>
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-xs leading-4 font-medium text-[var(--text-secondary)]">{copy.curva}</p>
        {anyone ? (
          <svg
            aria-label={copy.resumoCurva(presentNow, Math.max(...presence.curve.map((point) => point.present), 0))}
            className="h-[72px] w-full text-[var(--text-primary)]"
            preserveAspectRatio="none"
            role="img"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          >
            {presence.curve.map((point, index) => {
              const height = point.present > 0 ? Math.max(2, (point.present / max) * HEIGHT) : 0;
              return (
                <rect fill="currentColor" height={height} key={point.minute} opacity={index === presence.curve.length - 1 ? 1 : 0.6} width={Math.max(1, barWidth - 1)} x={index * barWidth} y={HEIGHT - height}>
                  <title>{copy.pontoDaCurva(consolePresenceMinuteLabel(point.minute), point.present)}</title>
                </rect>
              );
            })}
          </svg>
        ) : (
          <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{copy.semPresenca}</p>
        )}
      </div>
    </SectionCard>
  );
}
