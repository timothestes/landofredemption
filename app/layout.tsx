import { GeistSans } from "geist/font/sans";
import { Cinzel } from "next/font/google";
import { ThemeProvider } from "next-themes";
import Background from "../components/ui/background"; // Using the improved background
import { AdminProvider } from "../components/providers/AdminProvider";
import ChunkErrorReloader from "../components/ChunkErrorReloader";
import { InputModeReflector } from '@/app/shared/components/InputModeReflector';
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

const cinzel = Cinzel({ subsets: ["latin"], variable: "--font-cinzel" });

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || defaultUrl;

export const metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Land of Redemption – Redemption CCG Strategy, Deck Building, and Tournaments",
    template: "%s | Land of Redemption",
  },
  description:
    "Deck builder, tournament software, online play, articles, and rulings for the Redemption collectible card game.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${GeistSans.className} ${cinzel.variable}`} suppressHydrationWarning>
      <body className="bg-background text-foreground">
        <InputModeReflector />
        <ChunkErrorReloader />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          themes={["light", "dark", "jayden", "system"]}
        >
          <AdminProvider>
            <Background>
              <main className="min-h-screen flex flex-col">{children}</main>
            </Background>
          </AdminProvider>
        </ThemeProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
