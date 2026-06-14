import { AppShell } from "@/components/app-shell";
import { MemberFooter } from "@/components/member-footer";
import { PurchasesExperience } from "@/components/purchases-experience";
import { purchasedProducts } from "@/lib/mock-data";

export default function PurchasesPage() {
  return (
    <AppShell>
      <PurchasesExperience items={purchasedProducts} />
      <MemberFooter />
    </AppShell>
  );
}
