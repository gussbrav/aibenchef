import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Aibenchef — Data SBS Peru, sin Excels",
    template: "%s | Aibenchef",
  },
  description:
    "Plataforma de inteligencia para data publica de la SBS. Comparativos, ratios y dashboards de bancos, financieras, cajas municipales, rurales y EDPYMEs.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es-PE">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
