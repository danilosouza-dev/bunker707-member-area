import { AppShell } from "@/components/app-shell";
import { ContentRow } from "@/components/content-row";
import { HeroSection } from "@/components/hero-section";
import { MemberFooter } from "@/components/member-footer";
import { homeRows } from "@/lib/mock-data";

export default function Home() {
  return (
    <AppShell>
      <HeroSection />
      <div className="relative z-20 -mt-24 space-y-20 pb-24">
        {homeRows.map((row) => (
          <ContentRow
            items={row.items}
            key={row.id}
            subtitle={row.subtitle}
            title={row.title}
            variant={row.variant}
          />
        ))}
      </div>
      <MemberFooter />
    </AppShell>
  );
}
