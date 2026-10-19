import { PostHogAnalytics } from "@/components/analytics/posthog-analytics";
import { getSessionUser } from "@/server/auth/session";

// Server Component: reaproveita a sessao memoizada por request (React.cache, getSessionUser: claims do JWT
// ou getUser), entao paginas protegidas nao pagam outra validacao. So o id interno vai ao navegador.
export async function PostHogIdentity() {
  const user = await getSessionUser();

  return <PostHogAnalytics userId={user?.id ?? null} />;
}
