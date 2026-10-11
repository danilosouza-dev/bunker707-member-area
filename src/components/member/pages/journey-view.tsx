import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  CircleCheck,
  CircleCheckBig,
  CirclePlay,
  History,
  ImageOff,
  LibraryBig,
  LockKeyhole,
  Play,
  Route
} from "lucide-react";
import { MemberButtonLink } from "@/components/member/ui/member-button";
import { MemberChip, type MemberChipTone } from "@/components/member/ui/member-chip";
import { MemberEmptyState } from "@/components/member/ui/member-empty-state";
import { MemberLessonCard } from "@/components/member/ui/member-lesson-card";
import { MemberPage, MemberPageHeader, MemberSection } from "@/components/member/ui/member-page";
import { MemberProgressBar } from "@/components/member/ui/member-progress";
import { MemberStat, MemberStatGrid } from "@/components/member/ui/member-stat";
import { MemberSurface } from "@/components/member/ui/member-surface";
import { withAccessPreviewParam, type AccessPreviewMode } from "@/lib/access-preview";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import { formatMemberCount } from "@/lib/member-format";
import type { MemberProgressStatus } from "@/lib/member-library";
import { MEMBER_ROUTES } from "@/lib/member-navigation";
import { cn } from "@/lib/utils";
import type { JourneyActivityView, JourneyProductView, JourneyView as JourneyViewModel } from "@/server/member-area/student-pages-model";

// Minha jornada: numeros reais do aluno, aulas para retomar, progresso por curso e atividade recente.
// Tudo vem da biblioteca do proprio aluno (modelo pronto do servidor); nada de pontos, ranking ou meta
// inventada.

const statusChips: Record<MemberProgressStatus, { icon?: typeof CircleCheck; tone: MemberChipTone }> = {
  completed: { icon: CircleCheck, tone: "success" },
  in_progress: { tone: "neutral" },
  not_started: { tone: "outline" }
};

function capitalize(text: string) {
  return text ? `${text.charAt(0).toLocaleUpperCase("pt-BR")}${text.slice(1)}` : text;
}

function JourneyProductCard({ priority, product }: { priority: boolean; product: JourneyProductView }) {
  const chip = statusChips[product.status];
  const image = product.image.trim();
  const hasLessons = product.totalLessons > 0;

  return (
    <article className="flex min-w-0 gap-4 rounded-[12px] border border-white/[0.08] bg-[#181818] p-3 transition-colors duration-200 hover:border-white/[0.16] sm:p-4">
      <Link
        aria-label={`Abrir ${product.title}`}
        className="relative aspect-[2/3] w-[76px] shrink-0 overflow-hidden rounded-[8px] bg-[#1f1f1f] ring-1 ring-white/[0.08] outline-none transition hover:ring-white/25 focus-visible:ring-2 focus-visible:ring-white/80 sm:w-[92px]"
        href={product.href}
      >
        {image ? (
          <Image
            alt=""
            className="object-cover"
            fill
            priority={priority}
            sizes="92px"
            src={image}
            unoptimized={!canOptimizeImageSrc(image)}
          />
        ) : (
          <span aria-hidden="true" className="absolute inset-0 grid place-items-center bg-[linear-gradient(160deg,#262626,#151515)] text-zinc-600">
            <ImageOff className="size-5" strokeWidth={1.8} />
          </span>
        )}
      </Link>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-1.5">
          <MemberChip tone="neutral">{product.kindLabel}</MemberChip>
          <MemberChip icon={chip.icon} tone={chip.tone}>
            {product.statusLabel}
          </MemberChip>
        </div>

        <h3 className="mt-2 line-clamp-2 text-[15px] font-bold leading-5 text-white sm:text-base">
          <Link className="rounded-[4px] outline-none hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" href={product.href}>
            {product.title}
          </Link>
        </h3>

        {hasLessons ? (
          <>
            <div className="mt-3 flex items-center gap-3">
              <MemberProgressBar className="flex-1" label={`Progresso em ${product.title}`} value={product.percent} />
              <span className="w-9 shrink-0 text-right text-xs font-bold tabular-nums text-white">{product.percent}%</span>
            </div>
            <p className="mt-1.5 truncate text-xs text-zinc-400">
              {product.completedLessons} de {formatMemberCount(product.totalLessons, "aula")}
              {product.lastActivityLabel ? <span className="text-zinc-500"> · {product.lastActivityLabel}</span> : null}
            </p>
          </>
        ) : (
          <p className="mt-3 text-xs text-zinc-500">Nenhuma aula publicada ainda.</p>
        )}

        {product.lockedLessons > 0 || product.nextReleaseLabel ? (
          <p className="mt-2 flex min-w-0 items-start gap-1.5 text-xs font-semibold leading-4 text-amber-200">
            <LockKeyhole aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            <span className="min-w-0">
              {product.lockedLessons > 0 ? `${formatMemberCount(product.lockedLessons, "aula")} para liberar` : null}
              {product.lockedLessons > 0 && product.nextReleaseLabel ? " · " : null}
              {product.nextReleaseLabel ? <span className="font-medium text-amber-100/80">{product.nextReleaseLabel}</span> : null}
            </span>
          </p>
        ) : null}

        {product.resume ? (
          <div className="mt-auto pt-3">
            {product.resume.label !== "Revisar" ? (
              <p className="mb-2 truncate text-xs text-zinc-500">
                Próxima aula: <span className="font-medium text-zinc-300">{product.resume.lessonTitle}</span>
              </p>
            ) : null}
            <MemberButtonLink
              aria-label={`${product.resume.label}: ${product.resume.lessonTitle}`}
              href={product.resume.href}
              size="sm"
              variant={product.resume.label === "Revisar" ? "secondary" : "primary"}
            >
              <Play className="fill-current" />
              {product.resume.label}
            </MemberButtonLink>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function JourneyActivityList({ items }: { items: JourneyActivityView[] }) {
  return (
    <ol className="grid">
      {items.map((item, index) => (
        <li className="relative flex min-w-0 gap-3 pb-5 last:pb-0" key={item.id}>
          {index < items.length - 1 ? (
            <span aria-hidden="true" className="absolute bottom-0 left-[15px] top-9 w-px bg-white/[0.08]" />
          ) : null}
          <span
            aria-hidden="true"
            className={cn(
              "relative grid size-8 shrink-0 place-items-center rounded-full border",
              item.completed
                ? "border-emerald-400/25 bg-emerald-500/12 text-emerald-300"
                : "border-white/10 bg-white/[0.06] text-zinc-200"
            )}
          >
            {item.completed ? <CircleCheck className="size-4" strokeWidth={2.2} /> : <Play className="ml-0.5 size-3.5 fill-current" />}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <Link
              className="line-clamp-2 rounded-[4px] text-sm font-semibold leading-5 text-white outline-none hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              href={item.href}
            >
              {item.title}
            </Link>
            {item.context ? <p className="mt-0.5 truncate text-xs text-zinc-500">{item.context}</p> : null}
            <p className="mt-1 text-[11px] font-medium text-zinc-500">
              <span className={item.completed ? "text-emerald-300" : "text-zinc-300"}>{item.statusLabel}</span>
              {item.timeLabel ? <> · {item.timeLabel}</> : null}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function JourneyView({ accessPreviewMode, view }: { accessPreviewMode?: AccessPreviewMode; view: JourneyViewModel }) {
  const purchasesHref = withAccessPreviewParam(MEMBER_ROUTES.purchases, accessPreviewMode);
  const homeHref = withAccessPreviewParam(MEMBER_ROUTES.home, accessPreviewMode);
  const continueHref = withAccessPreviewParam(MEMBER_ROUTES.continueWatching, accessPreviewMode);
  const { stats } = view;

  if (view.products.length === 0) {
    return (
      <MemberPage>
        <MemberPageHeader
          description="Acompanhe o que você já estudou e continue de onde parou."
          eyebrow={{ icon: Route, label: "Seu progresso" }}
          title="Minha jornada"
        />
        <MemberEmptyState
          action={
            <>
              <MemberButtonLink href={homeHref} variant="primary">
                Ir para o início
              </MemberButtonLink>
              <MemberButtonLink href={purchasesHref}>Ver minhas compras</MemberButtonLink>
            </>
          }
          description="Quando você tiver um curso liberado, o seu progresso em cada aula aparece aqui."
          icon={Route}
          title="Sua jornada começa na primeira aula"
        />
      </MemberPage>
    );
  }

  return (
    <MemberPage>
      <MemberPageHeader
        actions={
          view.primaryAction ? (
            <MemberButtonLink href={view.primaryAction.href} size="lg" variant="primary">
              <Play className="fill-current" />
              {view.primaryAction.label}
            </MemberButtonLink>
          ) : null
        }
        description="Acompanhe o que você já estudou e continue de onde parou."
        eyebrow={{ icon: Route, label: "Seu progresso" }}
        title="Minha jornada"
      >
        <MemberStatGrid>
          <MemberStat
            hint={`de ${formatMemberCount(stats.totalLessons, "aula")}`}
            icon={CircleCheckBig}
            label="Aulas concluídas"
            value={stats.completedLessons}
          />
          <MemberStat hint={`de ${stats.totalContents}`} icon={CirclePlay} label="Cursos em andamento" value={stats.inProgressContents} />
          <MemberStat hint={`de ${stats.totalContents}`} icon={BadgeCheck} label="Cursos concluídos" value={stats.completedContents} />
          {stats.lastActivityLabel ? (
            <MemberStat icon={History} label="Última aula assistida" value={capitalize(stats.lastActivityLabel)} />
          ) : (
            <MemberStat icon={LibraryBig} label="Cursos liberados" value={stats.totalContents} />
          )}
        </MemberStatGrid>
      </MemberPageHeader>

      <div className="grid gap-12 sm:gap-14">
        {view.continueWatching.length > 0 ? (
          <MemberSection
            action={
              <Link
                className="inline-flex items-center gap-1.5 rounded-[6px] text-sm font-semibold text-zinc-300 outline-none transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                href={continueHref}
              >
                Ver tudo
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            }
            count={view.continueWatchingTotal}
            id="continue-de-onde-parou"
            title="Continue de onde parou"
          >
            <div className="grid gap-x-4 gap-y-7 sm:grid-cols-2 xl:grid-cols-4 max-sm:[&>*:nth-child(n+3)]:hidden">
              {view.continueWatching.map((card) => (
                <MemberLessonCard
                  context={card.context}
                  href={card.href}
                  image={card.image}
                  key={card.id}
                  meta={card.meta}
                  progress={card.progressPercent === null ? undefined : { label: `Progresso em ${card.title}`, value: card.progressPercent }}
                  thumbnailLabel={card.thumbnailLabel}
                  title={card.title}
                />
              ))}
            </div>
          </MemberSection>
        ) : null}

        <div className="grid gap-12 xl:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] xl:gap-10">
          <MemberSection
            count={view.products.length}
            description="Seu progresso em cada formação, curso e bootcamp que você pode acessar."
            id="seus-cursos"
            title="Seus cursos"
          >
            <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
              {view.products.map((product, index) => (
                <JourneyProductCard key={product.id} priority={index < 2} product={product} />
              ))}
            </div>
          </MemberSection>

          <MemberSection id="atividade-recente" title="Atividade recente">
            {view.activity.length > 0 ? (
              <MemberSurface padding="md">
                <JourneyActivityList items={view.activity} />
              </MemberSurface>
            ) : (
              <MemberEmptyState
                description="As aulas que você assistir aparecem aqui, da mais recente para a mais antiga."
                icon={History}
                size="compact"
                title="Nenhuma aula assistida ainda"
              />
            )}
          </MemberSection>
        </div>
      </div>
    </MemberPage>
  );
}
