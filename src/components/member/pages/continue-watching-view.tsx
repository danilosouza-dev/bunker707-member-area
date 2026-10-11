import { CircleCheck, CirclePlay, Route } from "lucide-react";
import { MemberButtonLink } from "@/components/member/ui/member-button";
import { MemberEmptyState } from "@/components/member/ui/member-empty-state";
import { MemberLessonCard, memberLessonGridClassName } from "@/components/member/ui/member-lesson-card";
import { MemberPage, MemberPageHeader, MemberSection } from "@/components/member/ui/member-page";
import { withAccessPreviewParam, type AccessPreviewMode } from "@/lib/access-preview";
import { MEMBER_ROUTES } from "@/lib/member-navigation";
import type { ContinueWatchingView as ContinueWatchingViewModel, StudentLessonCardView } from "@/server/member-area/student-pages-model";

// Continue assistindo: aulas comecadas e nao terminadas (mesma regra da fileira da home), da mais
// recente para a mais antiga, e as concluidas recentemente para revisar.

function LessonCardGrid({ cards }: { cards: StudentLessonCardView[] }) {
  return (
    <div className={memberLessonGridClassName}>
      {cards.map((card) => (
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
  );
}

export function ContinueWatchingView({
  accessPreviewMode,
  view
}: {
  accessPreviewMode?: AccessPreviewMode;
  view: ContinueWatchingViewModel;
}) {
  const purchasesHref = withAccessPreviewParam(MEMBER_ROUTES.purchases, accessPreviewMode);
  const journeyHref = withAccessPreviewParam(MEMBER_ROUTES.journey, accessPreviewMode);
  const resume = view.inProgress[0];

  return (
    <MemberPage>
      <MemberPageHeader
        actions={
          resume ? (
            <MemberButtonLink aria-label={`Retomar ${resume.title}`} href={resume.href} size="lg" variant="primary">
              <CirclePlay />
              Retomar a última aula
            </MemberButtonLink>
          ) : null
        }
        description="Aulas que você começou e ainda não terminou, da mais recente para a mais antiga."
        eyebrow={{ icon: CirclePlay, label: "Retome seus estudos" }}
        title="Continue assistindo"
      />

      <div className="grid gap-12 sm:gap-14">
        {view.inProgress.length > 0 ? (
          <MemberSection count={view.inProgress.length} id="em-andamento" title="Em andamento">
            <LessonCardGrid cards={view.inProgress} />
          </MemberSection>
        ) : (
          <MemberEmptyState
            action={
              <>
                <MemberButtonLink href={purchasesHref} variant="primary">
                  Ver minhas compras
                </MemberButtonLink>
                <MemberButtonLink href={journeyHref}>
                  <Route />
                  Minha jornada
                </MemberButtonLink>
              </>
            }
            description="Quando você começar uma aula e parar no meio, ela aparece aqui para você voltar do ponto onde parou."
            icon={CirclePlay}
            title="Nenhuma aula em andamento"
          />
        )}

        {view.recentlyCompleted.length > 0 ? (
          <MemberSection
            count={view.recentlyCompleted.length}
            description="Para revisar o que você já terminou."
            id="concluidas-recentemente"
            title={
              <>
                <CircleCheck aria-hidden="true" className="size-[18px] text-emerald-400" strokeWidth={2.2} />
                Concluídas recentemente
              </>
            }
          >
            <LessonCardGrid cards={view.recentlyCompleted} />
          </MemberSection>
        ) : null}
      </div>
    </MemberPage>
  );
}
