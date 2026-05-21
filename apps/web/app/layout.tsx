import type { Metadata, Viewport } from "next";
import "./globals.css";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://aibenchef.azoramind.com";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: "Aibenchef · Inteligencia financiera SBS Perú",
    template: "%s · Aibenchef",
  },
  description:
    "Toda la data pública de la SBS limpia, comparada y visualizada. Bancos, financieras, cajas municipales, rurales y EDPYMEs en una sola plataforma. Decisiones en minutos, no semanas.",
  keywords: [
    "SBS",
    "banca peruana",
    "microfinanzas Perú",
    "estados financieros",
    "Caja Arequipa",
    "Banca Múltiple",
    "BI bancario",
    "Aibenchef",
  ],
  authors: [{ name: "Azoramind" }],
  creator: "Azoramind",
  publisher: "Azoramind",
  openGraph: {
    type: "website",
    locale: "es_PE",
    url: appUrl,
    siteName: "Aibenchef",
    title: "Aibenchef · Inteligencia financiera SBS Perú",
    description:
      "Toda la data pública de la SBS limpia, comparada y visualizada. Decisiones en minutos, no semanas.",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Aibenchef",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Aibenchef · Inteligencia financiera SBS Perú",
    description:
      "Toda la data pública de la SBS limpia, comparada y visualizada. Decisiones en minutos, no semanas.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    apple: "/favicon.svg",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es-PE">
      <body className="font-sans antialiased text-slate-900">{children}</body>
    </html>
  );
}
