import type { Metadata } from "next";
import { Exo_2, Inter } from "next/font/google";
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

export const metadata: Metadata = {
  title: "Bunker707",
  description: "Area de membros da escola de IA Bunker707"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className={`${inter.variable} ${exo2.variable} antialiased`} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
