import { AdminShellSkeleton } from "@/components/admin/v2/skeletons";

// Este loading envolve todo /admin: skeleton com a forma final (docs/17 §2.7), nunca o spinner de
// tela cheia.
export default function AdminLoading() {
  return <AdminShellSkeleton />;
}
