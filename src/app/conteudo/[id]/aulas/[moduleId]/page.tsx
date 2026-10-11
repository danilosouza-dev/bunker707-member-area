import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { LessonExperience } from "@/components/lesson-experience";
import { MemberFooter } from "@/components/member-footer";
import { normalizeAccessPreviewMode } from "@/lib/access-preview";
import { getAppShellData, getLessonPageData } from "@/server/db/platform-store";
import { requirePageUser } from "@/server/auth/guards";

type LessonPageProps = {
  params: Promise<{
    id: string;
    moduleId: string;
  }>;
  searchParams?: Promise<{
    accessPreview?: string | string[];
    lessonId?: string | string[];
  }>;
};

export const dynamic = "force-dynamic";

export default async function LessonPage({ params, searchParams }: LessonPageProps) {
  const { id, moduleId } = await params;
  const resolvedSearchParams = await searchParams;
  const requestedAccessPreviewMode = normalizeAccessPreviewMode(resolvedSearchParams?.accessPreview);
  const requestedLessonId = Array.isArray(resolvedSearchParams?.lessonId)
    ? resolvedSearchParams.lessonId[0]
    : resolvedSearchParams?.lessonId;
  const user = await requirePageUser(`/conteudo/${id}/aulas/${moduleId}`);
  const shellData = await getAppShellData(user);
  const accessPreviewMode = shellData.canUseAccessPreview ? requestedAccessPreviewMode : undefined;
  const lessonPageData = await getLessonPageData(id, moduleId, user, accessPreviewMode);

  if (!lessonPageData) {
    notFound();
  }

  if (lessonPageData.item.isLocked) {
    redirect("/");
  }

  const { allModules, initialLessonReactions, initialLessonWatchStates, item, returnContent, selectedModule } = lessonPageData;

  return (
    <AppShell
      accessPreviewMode={accessPreviewMode}
      branding={shellData.branding}
      canUseAccessPreview={shellData.canUseAccessPreview}
      student={shellData.student}
    >
      <div className="min-h-screen bg-[#141414] px-5 pb-16 pt-24 sm:px-8 lg:px-12">
        <LessonExperience
          accessPreviewMode={accessPreviewMode}
          allModules={allModules}
          currentUserId={user.id}
          currentUserName={shellData.student.fullName}
          initialLessonId={requestedLessonId}
          initialLessonReactions={initialLessonReactions}
          initialLessonWatchStates={initialLessonWatchStates}
          item={item}
          key={`${selectedModule.id}:${requestedLessonId ?? "auto"}`}
          returnContent={returnContent}
          selectedModule={selectedModule}
        />
      </div>
      <MemberFooter branding={shellData.branding} />
    </AppShell>
  );
}
