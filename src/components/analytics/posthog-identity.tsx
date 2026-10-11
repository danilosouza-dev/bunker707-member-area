import { PostHogAnalytics } from "@/components/analytics/posthog-analytics";
import { getAuthenticatedUser } from "@/server/auth/session";

// Server Component: reaproveita o getUser() memoizado por request (React.cache), entao paginas protegidas
// nao pagam uma segunda validacao. So o id interno vai ao navegador; e-mail e nome ficam no servidor.
export async function PostHogIdentity() {
  const user = await getAuthenticatedUser();

  return <PostHogAnalytics userId={user?.id ?? null} />;
}
