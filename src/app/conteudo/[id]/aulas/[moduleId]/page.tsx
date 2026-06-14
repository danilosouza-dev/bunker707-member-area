import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { LessonExperience } from "@/components/lesson-experience";
import { MemberFooter } from "@/components/member-footer";
import { allContentItems, courseModules, formations } from "@/lib/mock-data";

type LessonPageProps = {
  params: Promise<{
    id: string;
    moduleId: string;
  }>;
};

export function generateStaticParams() {
  return allContentItems.flatMap((item) => (
    courseModules.map((module) => ({
      id: item.id,
      moduleId: module.id
    }))
  ));
}

export default async function LessonPage({ params }: LessonPageProps) {
  const { id, moduleId } = await params;
  const item = allContentItems.find((content) => content.id === id);
  const selectedModule = courseModules.find((courseModule) => courseModule.id === moduleId);
  const parentFormation = item?.commerceScope === "included_content" ? formations[0] : undefined;

  if (!item || !selectedModule) {
    notFound();
  }

  return (
    <AppShell>
      <div className="min-h-screen bg-[#141414] px-5 pb-16 pt-24 sm:px-8 lg:px-12">
        <LessonExperience
          allModules={courseModules}
          item={item}
          key={selectedModule.id}
          returnContent={parentFormation}
          selectedModule={selectedModule}
        />
      </div>
      <MemberFooter />
    </AppShell>
  );
}
