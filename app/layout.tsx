import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { Cinzel } from "next/font/google";
import { ThemeProvider } from "next-themes";
import Background from "../components/ui/background"; // Using the improved background
import { AdminProvider } from "../components/providers/AdminProvider";
import ChunkErrorReloader from "../components/ChunkErrorReloader";
import { InputModeReflector } from '@/app/shared/components/InputModeReflector';
import { getSiteUrl } from "@/lib/siteUrl";
import "./globals.css";

const cinzel = Cinzel({ subsets: ["latin"], variable: "--font-cinzel" });

// No maximumScale: it blocked pinch-zoom on phones.
export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: "Land of Redemption – Redemption CCG Strategy, Deck Building, and Tournaments",
    template: "%s | Land of Redemption",
  },
  description:
    "Deck builder, tournament software, online play, articles, and rulings for the Redemption collectible card game.",
  // Inherited by every page that does not define its own openGraph/twitter
  // block; og:title and og:description fall back to the page's own.
  openGraph: {
    siteName: "Land of Redemption",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
  },
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
      </body>
    </html>
  );
}
