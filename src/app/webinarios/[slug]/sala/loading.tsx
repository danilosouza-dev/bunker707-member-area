import { MemberShellSkeleton, MemberSkeletonBlock } from "@/components/member/ui/member-skeletons";
import { WEBINAR_COPY } from "@/lib/webinar-copy";

// Esqueleto da Sala (a gravada, o replay e a ao vivo): o palco em 16:9 e o painel do chat ao lado, com os 320 px do
// painel da sala (docs/31 V2-7; embaixo, no celular). A frase e a de WEBINAR_COPY, como as da sala.
export default function Loading() {
  return (
    <MemberShellSkeleton label={WEBINAR_COPY.aoVivo.abrindo}>
      <div className="flex min-h-[70vh] flex-col gap-3 p-3 lg:flex-row">
        <MemberSkeletonBlock className="aspect-video w-full rounded-[12px] lg:aspect-auto lg:min-h-[60vh] lg:flex-1" />
        <div className="flex flex-col gap-2 lg:w-80">
          <MemberSkeletonBlock className="h-11 w-full rounded-[10px]" />
          <MemberSkeletonBlock className="h-4 w-2/3" />
          <MemberSkeletonBlock className="h-4 w-1/2" />
          <MemberSkeletonBlock className="h-4 w-3/4" />
          <MemberSkeletonBlock className="mt-auto h-11 w-full rounded-[12px]" />
        </div>
      </div>
    </MemberShellSkeleton>
  );
}
