import type { Metadata } from "next";
import { Exo_2, Inter } from "next/font/google";
import { Suspense } from "react";
import { PostHogIdentity } from "@/components/analytics/posthog-identity";
import { SpeedInsights } from "@/components/analytics/speed-insights";
import { NavigationFeedbackProvider } from "@/components/navigation-feedback";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter"
});

const exo2 = Exo_2({
  subsets: ["latin"],
  variable: "--font-exo-2",
  weight: ["500", "600", "700"]
});

// Sem NEXT_PUBLIC_POSTHOG_KEY o layout nao le a sessao para analytics e posthog-js nunca e baixado.
const postHogEnabled = Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);

export const metadata: Metadata = {
  title: "Bunker707",
  description: "Area de membros da escola de IA Bunker707"
};

// A CSP de src/proxy.ts usa um nonce por pedido, e o Next so carimba esse nonce nos scripts de uma
// pagina renderizada no pedido. Pagina pre-renderizada no build sai sem nonce, o navegador bloqueia os
// scripts que revelam e hidratam o conteudo e a tela fica em branco (aconteceu com /tv ao ligar o proxy).
// Por isso nenhuma pagina deste app e pre-renderizada.
export const dynamic = "force-dynamic";

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Extensões do navegador injetam atributos em <html>/<body> antes da hidratação
    // (ex.: data-yd-*); a supressão vale só para atributos destes dois elementos.
    <html lang="pt-BR" suppressHydrationWarning>
      <body className={`${inter.variable} ${exo2.variable} antialiased`} suppressHydrationWarning>
        <Suspense fallback={null}>
          <NavigationFeedbackProvider>{children}</NavigationFeedbackProvider>
        </Suspense>
        <SpeedInsights />
        {postHogEnabled ? (
          <Suspense fallback={null}>
            <PostHogIdentity />
          </Suspense>
        ) : null}
      </body>
    </html>
  );
}
