import type { Metadata, Viewport } from "next";
import "./globals.css";
import { FloatingWhatsApp } from "@/components/marketing/floating-whatsapp";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://aibenchef.azoramind.com";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: "Aibenchef · Inteligencia financiera del sistema financiero peruano",
    template: "%s · Aibenchef",
  },
  description:
    "Bancos, financieras, cajas municipales, cajas rurales y empresas de créditos — análisis y comparaciones de los 5 grupos regulados del sistema financiero peruano. Decisiones en minutos, no semanas.",
  keywords: [
    "banca peruana",
    "sistema financiero peruano",
    "microfinanzas Perú",
    "estados financieros",
    "benchmarking bancario",
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
    title: "Aibenchef · Inteligencia del sistema financiero peruano",
    description:
      "Análisis y comparaciones del sistema financiero peruano — limpio, listo y auditable. Decisiones en minutos, no semanas.",
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
    title: "Aibenchef · Inteligencia del sistema financiero peruano",
    description:
      "Análisis y comparaciones del sistema financiero peruano — limpio, listo y auditable. Decisiones en minutos, no semanas.",
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
      <body className="font-sans antialiased text-slate-900">
        {children}
        <FloatingWhatsApp />
      </body>
    </html>
  );
}
