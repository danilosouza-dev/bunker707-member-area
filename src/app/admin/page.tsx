import { AdminDashboard } from "@/components/admin-dashboard";
import { getAdminDashboardData } from "@/server/db/platform-store";
import { requirePageAdmin } from "@/server/auth/guards";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requirePageAdmin();
  const data = await getAdminDashboardData();

  return <AdminDashboard initialData={data} />;
}
