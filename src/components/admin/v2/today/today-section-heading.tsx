type TodaySectionHeadingProps = {
  id: string;
  /** Frase de apoio na mesma linha do titulo (12/500, terciaria); quebra para baixo quando nao cabe. */
  meta?: string;
  title: string;
};

/** Titulo de secao do Hoje (H2 18/600), como no prototipo: "Precisa de atenção hoje", "Números dos últimos 30 dias". */
export function TodaySectionHeading({ id, meta, title }: TodaySectionHeadingProps) {
  return (
    <div className="flex min-h-7 flex-wrap items-baseline gap-x-2.5 gap-y-1">
      <h2 className="text-lg leading-7 font-semibold tracking-[-0.01em] text-[var(--text-primary)]" id={id}>
        {title}
      </h2>
      {meta ? <p className="text-xs leading-4 font-medium text-[var(--text-tertiary)]">{meta}</p> : null}
    </div>
  );
}
